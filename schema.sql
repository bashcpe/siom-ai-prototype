# PostgreSQL Schema for Siom AI tite

-- Table for appointments
CREATE TABLE IF NOT EXISTS appointments (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  patient_name TEXT NOT NULL,
  doctor_name TEXT,
  appointment_date TIMESTAMP NOT NULL,
  duration_minutes INTEGER DEFAULT 30,
  reason TEXT,
  status TEXT DEFAULT 'scheduled', -- 'scheduled', 'cancelled', 'rescheduled'
  google_event_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table for user sessions/tokens (if not using a separate auth provider)
CREATE TABLE IF NOT EXISTS user_tokens (
  user_id TEXT PRIMARY KEY,
  access_token TEXT,
  refresh_token TEXT,
  expiry_date BIGINT
);
