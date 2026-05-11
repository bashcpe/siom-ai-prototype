import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import cookieSession from "cookie-session";
import pg from "pg";
import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

// DB Configuration
const pool = new Pool({
  user: process.env.POSTGRES_USER,
  host: process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DB,
  password: process.env.POSTGRES_PASSWORD,
  port: 5432,
});

// Google Calendar OAuth Configuration
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.APP_URL}/auth/callback`
);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());
  app.use(
    cookieSession({
      name: "medi_sync_session",
      keys: [process.env.SESSION_SECRET || "default_secret"],
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      secure: true,
      sameSite: "none",
    })
  );

  // --- API Routes ---

  // DB Health Check
  app.get("/api/db-status", async (req, res) => {
    try {
      const client = await pool.connect();
      client.release();
      res.json({ connected: true });
    } catch (err) {
      res.status(500).json({ connected: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Get Appointments
  app.get("/api/appointments", async (req, res) => {
    try {
      const result = await pool.query("SELECT * FROM appointments ORDER BY appointment_date ASC");
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch appointments" });
    }
  });

  // Create Appointment
  app.post("/api/appointments", async (req, res) => {
    const { patientName, doctorName, date, reason, userId } = req.body;
    try {
      const result = await pool.query(
        "INSERT INTO appointments (patient_name, doctor_name, appointment_date, reason, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING *",
        [patientName, doctorName || "General Practitioner", date, reason, userId || "system"]
      );
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: "Failed to create appointment" });
    }
  });

  // Update/Reschedule Appointment
  app.put("/api/appointments/:id", async (req, res) => {
    const { id } = req.params;
    const { date, status } = req.body;
    try {
      let query = "UPDATE appointments SET updated_at = CURRENT_TIMESTAMP";
      const params: any[] = [id];
      let paramIndex = 2;

      if (date) {
        query += `, appointment_date = $${paramIndex++}`;
        params.push(date);
      }
      if (status) {
        query += `, status = $${paramIndex++}`;
        params.push(status);
      }

      query += ` WHERE id = $1 RETURNING *`;
      const result = await pool.query(query, params);
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: "Failed to update appointment" });
    }
  });

  // OAuth Setup
  app.get("/api/auth/url", (req, res) => {
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: ["https://www.googleapis.com/auth/calendar"],
      prompt: "consent"
    });
    res.json({ url });
  });

  app.get("/auth/callback", async (req, res) => {
    const { code } = req.query;
    try {
      const { tokens } = await oauth2Client.getToken(code as string);
      oauth2Client.setCredentials(tokens);
      if (req.session) {
        req.session.tokens = tokens;
      }
      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>Authentication successful. You can close this window.</p>
          </body>
        </html>
      `);
    } catch (err) {
      res.status(500).send("Authentication failed");
    }
  });

  // Sync with Google Calendar (Simplified Example)
  app.post("/api/sync-calendar", async (req, res) => {
    const tokens = req.session?.tokens;
    if (!tokens) {
      return res.status(401).json({ error: "Not authenticated with Google" });
    }
    const { appointmentId } = req.body;
    try {
      oauth2Client.setCredentials(tokens);
      const calendar = google.calendar({ version: "v3", auth: oauth2Client });
      
      const aptResult = await pool.query("SELECT * FROM appointments WHERE id = $1", [appointmentId]);
      const apt = aptResult.rows[0];

      if (!apt) return res.status(404).json({ error: "Appointment not found" });

      const event = {
        summary: `Clinical Appointment: ${apt.patient_name} with ${apt.doctor_name || 'Dr.'}`,
        description: `Reason: ${apt.reason || 'Routine Checkup'}`,
        start: { dateTime: apt.appointment_date.toISOString() },
        end: { dateTime: new Date(new Date(apt.appointment_date).getTime() + 30 * 60000).toISOString() },
        reminders: { 
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 },
            { method: 'popup', minutes: 30 }
          ]
        },
      };

      const googleResponse = await calendar.events.insert({
        calendarId: "primary",
        requestBody: event,
      });

      await pool.query("UPDATE appointments SET google_event_id = $1 WHERE id = $2", [googleResponse.data.id, appointmentId]);
      res.json({ success: true, eventId: googleResponse.data.id });
    } catch (err) {
      res.status(500).json({ error: "Sync failed" });
    }
  });

  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
