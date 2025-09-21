require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const axios = require('axios'); // Added for proxying AI endpoints

const app = express();
const PORT = process.env.PORT || 3001;

const ML_API_URL = process.env.ML_API_URL;
const ADVISORY_API_URL = process.env.ADVISORY_API_URL;

app.use(express.json());

// MongoDB
mongoose
  .connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected for unified backend'))
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Sessions
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'demo_secret_key_for_final_year_project',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24, httpOnly: true, secure: false },
  })
);

// Schemas
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  email: { type: String, required: true },
});
const User = mongoose.model('User', userSchema);

const readingSchema = new mongoose.Schema(
  {
    temperature: { type: Number, required: true },
    humidity: { type: Number, required: true },
    mq2: { type: Number, required: true },
    rainfall: { type: Number, default: 0 },
    windSpeed: { type: Number },        // optional
    pressure: { type: Number },         // optional
    uvIndex: { type: Number },          // optional
    weatherDescription: { type: String },
    city: String,
    state: String,
    country: String,
    lat: Number,
    lon: Number,
  },
  { timestamps: true }
);
const Reading = mongoose.model('Reading', readingSchema);

// Replace SCRS_LOCATIONS with cities/towns
const SCRS_LOCATIONS = [
  { id: 'bengaluru',   name: 'Bengaluru',   lat: 12.9716, lon: 77.5946 },
  { id: 'tumakuru',    name: 'Tumakuru',    lat: 13.3409, lon: 77.1010 },
  { id: 'mysuru',      name: 'Mysuru',      lat: 12.2958, lon: 76.6394 },
  { id: 'hassan',      name: 'Hassan',      lat: 13.0072, lon: 76.0967 },
  { id: 'mangaluru',   name: 'Mangaluru',   lat: 12.9141, lon: 74.8560 },
  { id: 'hubballi',    name: 'Hubballi',    lat: 15.3647, lon: 75.1240 },
  { id: 'belagavi',    name: 'Belagavi',    lat: 15.8497, lon: 74.4977 },
  { id: 'shivamogga',  name: 'Shivamogga',  lat: 13.9299, lon: 75.5681 },
  { id: 'ballari',     name: 'Ballari',     lat: 15.1394, lon: 76.9214 },
  { id: 'davanagere',  name: 'Davanagere',  lat: 14.4669, lon: 75.9238 },
];

// One-document settings collection (global override for now)
const settingsSchema = new mongoose.Schema({ selectedLocationId: String }, { timestamps: true });
const Settings = mongoose.model('Settings', settingsSchema);

// Get list
app.get('/scrs/locations', (req, res) => res.json({ success: true, locations: SCRS_LOCATIONS }));

// Set selected location
app.post('/scrs/override_location', async (req, res) => {
  try {
    const { locationId } = req.body || {};
    const exists = SCRS_LOCATIONS.find(x => x.id === locationId);
    if (!exists) return res.status(400).json({ success: false, message: 'Invalid locationId' });
    await Settings.updateOne({}, { selectedLocationId: locationId }, { upsert: true });
    res.json({ success: true, message: 'Location override set', location: exists });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to set override', error: e.message });
  }
});

function getWeatherDescription(temp, humidity) {
  if (temp == null || humidity == null) return 'Unknown';
  if (temp < 15) return 'Cold';
  if (temp < 25) return 'Cool';
  if (temp < 35) return 'Warm';
  if (humidity > 80) return 'Humid';
  if (humidity < 30) return 'Dry';
  return 'Pleasant';
}

// Auth endpoints
app.post('/register', async (req, res) => {
  const { username, password, email } = req.body || {};
  if (!username || !password || !email) return res.status(400).json({ message: 'Username, password, and email required' });

  try {
    const exists = await User.findOne({ username });
    if (exists) return res.status(409).json({ message: 'Username already exists' });

    const hashed = await bcrypt.hash(password, 10);
    await new User({ username, password: hashed, email }).save();
    res.status(201).json({ message: 'User registered successfully' });
  } catch (e) {
    console.error('Register error:', e);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  console.log('=== LOGIN DEBUG ===');
  console.log('Received username:', username);
  console.log('Received password length:', password ? password.length : 'undefined');
  
  if (!username || !password) {
    console.log('Missing username or password');
    return res.status(400).json({ message: 'Username and password required' });
  }

  try {
    const user = await User.findOne({ username });
    console.log('User found:', user ? 'Yes' : 'No');
    if (user) {
      console.log('Stored password hash:', user.password);
    }
    
    if (!user) {
      console.log('User not found in database');
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    const valid = await bcrypt.compare(password, user.password);
    console.log('Password comparison result:', valid);
    
    if (!valid) {
      console.log('Password comparison failed');
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    req.session.userId = user._id;
    req.session.username = user.username;
    console.log('Login successful for user:', user.username);
    res.json({ message: 'Login successful' });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ESP32 → Cloud ingestion
app.post('/api/sensor-data', async (req, res) => {
  try {
    const { temperature, humidity, mq2, rainfall } = req.body || {};
    if (temperature == null || humidity == null || mq2 == null)
      return res.status(400).json({ success: false, message: 'Missing required sensor data' });

    // Get current override
    const s = await Settings.findOne().lean();
    const chosen = s && SCRS_LOCATIONS.find(x => x.id === s.selectedLocationId);
    let loc = chosen
      ? { city: chosen.name, state: 'Karnataka', country: 'India', lat: chosen.lat, lon: chosen.lon }
      : { city: 'Bengaluru', state: 'Karnataka', country: 'India', lat: 12.9716, lon: 77.5946 };

    // Reverse geocode with OSM Nominatim for standardized naming (optional but nice)
    try {
      const nom = await axios.get('https://nominatim.openstreetmap.org/reverse', {
        params: { format: 'json', lat: loc.lat, lon: loc.lon, zoom: 12, addressdetails: 1 },
        headers: { 'User-Agent': 'smart-crop-advisor/1.0 (contact@example.com)' },
        timeout: 6000,
      });
      const a = nom.data?.address || {};
      loc.city = a.city || a.town || a.village || loc.city;
      loc.state = a.state || loc.state;
      loc.country = a.country || loc.country;
    } catch (_) {}

    // Weather enrichment (Open-Meteo)
    let wx = {};
    try {
      const w = await axios.get('https://api.open-meteo.com/v1/forecast', {
        params: {
          latitude: loc.lat, longitude: loc.lon, timezone: 'auto',
          current: 'wind_speed_10m,pressure_msl,uv_index',
          daily: 'precipitation_sum',
        },
        timeout: 6000,
      });
      const cur = w.data?.current || {};
      const daily = w.data?.daily || {};
      wx = {
        windSpeed: Number(cur.wind_speed_10m || 0),
        pressure: Number(cur.pressure_msl || 0),
        uvIndex: Number(cur.uv_index || 0),
        rainfall: Number((daily?.precipitation_sum?.[0] ?? rainfall ?? 0)),
      };
    } catch (_) {
      wx = { rainfall: Number(rainfall ?? 0) };
    }

    // GenAI weather description via Advisory API (short summary)
    // requires ADVISORY_API_URL to be set
    let aiWeatherDesc = getWeatherDescription(Number(temperature), Number(humidity)); // fallback
    try {
      if (ADVISORY_API_URL) {
        const promptPayload = {
          crop_name: 'general',
          temperature: Number(temperature),
          humidity: Number(humidity),
          rainfall: Number(wx.rainfall ?? 0),
          pollution_level:  _getPollutionLevelLocal(Number(mq2)), // simple helper below
          language: 'en',
          // optional: pass location context so GenAI can mention it
          location: { city: loc.city, state: loc.state, country: loc.country, lat: loc.lat, lon: loc.lon },
          mode: 'weather_summary' // your advisory server can branch on this flag
        };
        const ai = await axios.post(`${ADVISORY_API_URL}/generate_advisory`, promptPayload, { timeout: 15000 });
        // If your advisory returns { advisory_text }, reuse it as weatherDescription
        if (ai.data && ai.data.advisory_text) aiWeatherDesc = String(ai.data.advisory_text);
      }
    } catch (_) {
      // keep fallback on failures
    }

    function _getPollutionLevelLocal(mq2) {
      if (!Number.isFinite(mq2)) return 1;
      if (mq2 < 200) return 1;
      if (mq2 < 500) return 2;
      if (mq2 < 800) return 3;
      return 4;
    }

    const reading = await Reading.create({
      temperature: Number(temperature),
      humidity: Number(humidity),
      mq2: Number(mq2),
      rainfall: wx.rainfall,
      windSpeed: wx.windSpeed,
      pressure: wx.pressure,
      uvIndex: wx.uvIndex,
      weatherDescription: aiWeatherDesc, // <-- use GenAI text
      city: loc.city, state: loc.state, country: loc.country, lat: loc.lat, lon: loc.lon,
    });

    res.json({ success: true, message: 'Sensor data saved', data: reading });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Error processing sensor data', error: e.message });
  }
});

app.get('/api/esp32/status', (req, res) => {
  res.json({ status: 'OK', message: 'Smart Crop Backend is running', timestamp: new Date().toISOString() });
});

// Sensor data read endpoints (DB only)
app.get('/sensor_data/latest', async (req, res) => {
  try {
    const latest = await Reading.findOne().sort({ createdAt: -1 }).lean();
    if (!latest) return res.status(404).json({ success: false, message: 'No sensor data found' });
    res.json({ success: true, data: latest });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Error fetching latest sensor data', error: e.message });
  }
});

app.get('/sensor_data', async (req, res) => {
  try {
    const data = await Reading.find().sort({ createdAt: -1 }).limit(50).lean();
    res.json({ success: true, count: data.length, data });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Error fetching sensor data', error: e.message });
  }
});

app.get('/sensor_data/stats', async (req, res) => {
  try {
    const [stats] = await Reading.aggregate([
      { $group: { _id: null, avgTemperature: { $avg: '$temperature' }, avgHumidity: { $avg: '$humidity' }, totalReadings: { $sum: 1 } } },
    ]);
    res.json({
      success: true,
      stats: {
        avgTemperature: stats?.avgTemperature ?? 0,
        avgHumidity: stats?.avgHumidity ?? 0,
        totalReadings: stats?.totalReadings ?? 0,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Error fetching sensor statistics', error: e.message });
  }
});

// AI endpoints (proxied)
app.post('/predict', async (req, res) => {
  try {
    if (!ML_API_URL) return res.status(500).json({ error: 'ML_API_URL not configured' });
    const r = await axios.post(`${ML_API_URL}/predict`, req.body, { timeout: 15000 });
    res.json(r.data);
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: 'Prediction failed', details: e.response?.data || e.message });
  }
});

app.post('/generate_advisory', async (req, res) => {
  try {
    if (!ADVISORY_API_URL) return res.status(500).json({ error: 'ADVISORY_API_URL not configured' });
    const r = await axios.post(`${ADVISORY_API_URL}/generate_advisory`, req.body, { timeout: 30000 });
    res.json(r.data);
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: 'Advisory generation failed', details: e.response?.data || e.message });
  }
});

app.post('/get_educational_videos', async (req, res) => {
  try {
    if (!ADVISORY_API_URL) return res.status(500).json({ error: 'ADVISORY_API_URL not configured' });
    const r = await axios.post(`${ADVISORY_API_URL}/get_educational_videos`, req.body, { timeout: 30000 });
    res.json(r.data);
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: 'Failed to get educational videos', details: e.response?.data || e.message });
  }
});

app.post('/crop_care_advice', async (req, res) => {
  try {
    if (!ADVISORY_API_URL) return res.status(500).json({ error: 'ADVISORY_API_URL not configured' });
    const r = await axios.post(`${ADVISORY_API_URL}/crop_care_advice`, req.body, { timeout: 30000 });
    res.json(r.data);
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: 'Failed to get crop care advice', details: e.response?.data || e.message });
  }
});

// Add below your AI proxies
app.get('/scrs/weather_summary', async (req, res) => {
  try {
    const lang = (req.query.language || 'en').toString();
    const latest = await Reading.findOne().sort({ createdAt: -1 }).lean();
    if (!latest) return res.status(404).json({ success: false, message: 'No sensor data found' });

    // Prefer real numbers already saved on Reading
    const payload = {
      city: latest.city, state: latest.state, country: latest.country,
      lat: latest.lat, lon: latest.lon,
      temperature: latest.temperature,
      humidity: latest.humidity,
      rainfall: latest.rainfall ?? 0,
      windSpeed: latest.windSpeed ?? 0,
      pressure: latest.pressure ?? 0,
      uvIndex: latest.uvIndex ?? 0,
      language: lang,
    };

    let text = 'Weather summary unavailable.';
    if (ADVISORY_API_URL) {
      const r = await axios.post(`${ADVISORY_API_URL}/summarize_weather`, payload, { timeout: 15000 });
      if (r.data?.text) text = String(r.data.text);
    }
    return res.json({ success: true, text });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to summarize weather', error: e.message });
  }
});

// Health & root
app.get('/health', (req, res) => res.json({ status: 'OK', message: 'Unified Smart Crop Backend Server', timestamp: new Date().toISOString() }));
app.get('/', (req, res) =>
  res.json({
    message: 'Smart Crop Advisor Unified Backend',
    version: '1.0.0',
    endpoints: {
      'POST /register': 'User registration',
      'POST /login': 'User login',
      'POST /api/sensor-data': 'ESP32 sensor data endpoint',
      'GET /api/esp32/status': 'ESP32 status check',
      'GET /sensor_data/latest': 'Get latest sensor data',
      'GET /sensor_data': 'Get sensor data history',
      'GET /sensor_data/stats': 'Get stats',
      'POST /predict': 'Get crop recommendation',
      'POST /generate_advisory': 'Get advisory',
      'POST /get_educational_videos': 'AI video suggestions',
      'POST /crop_care_advice': 'Crop care advice',
      'GET /health': 'Health check',
    },
  })
);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Unified Smart Crop Backend running on http://localhost:${PORT}`);
  console.log('📊 All endpoints available on single server');
  console.log('🗃️ Using only ESP32 readings persisted in MongoDB');
  console.log(`📍 Location: ${process.env.LOCATION_CITY || 'Mumbai'}, ${process.env.LOCATION_COUNTRY || 'India'}`);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down unified backend server...');
  process.exit(0);
});
