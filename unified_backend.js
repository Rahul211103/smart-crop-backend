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

const LocationService = require('./location_service');
const locationService = new LocationService();

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
  if (!username || !password) return res.status(400).json({ message: 'Username and password required' });

  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ message: 'Invalid username or password' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ message: 'Invalid username or password' });

    req.session.userId = user._id;
    req.session.username = user.username;
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
    if (temperature == null || humidity == null || mq2 == null) {
      return res.status(400).json({ success: false, message: 'Missing required sensor data' });
    }

    // Get client IP (Render proxy adds x-forwarded-for)
    const fwd = req.headers['x-forwarded-for'];
    const clientIp = Array.isArray(fwd) ? fwd[0] : (fwd || req.ip || '');

    // Prefer lat/lon sent by ESP32; else derive from IP; else use env defaults
    const lat = req.body?.lat;
    const lon = req.body?.lon;

    let loc = {
      city: process.env.LOCATION_CITY || 'Bengaluru',
      state: process.env.LOCATION_STATE || 'Karnataka',
      country: process.env.LOCATION_COUNTRY || 'India',
      lat: lat ?? parseFloat(process.env.LOCATION_LAT || '12.9716'),
      lon: lon ?? parseFloat(process.env.LOCATION_LON || '77.5946'),
    };

    // If no lat/lon in payload, try IP → lat/lon via your location_service
    if (lat == null || lon == null) {
      try {
        const ipLoc = await locationService.geoLocateIP(clientIp);
        if (ipLoc?.lat && ipLoc?.lon) loc = { ...loc, ...ipLoc };
      } catch (_) {}
    }

    // Reverse geocode with OpenStreetMap Nominatim for accurate city/state/country
    try {
      const nom = await axios.get(
        'https://nominatim.openstreetmap.org/reverse',
        { params: { format: 'json', lat: loc.lat, lon: loc.lon, zoom: 10, addressdetails: 1 },
          headers: { 'User-Agent': 'smart-crop-advisor/1.0' } }
      );
      const a = nom.data?.address || {};
      loc.city = a.city || a.town || a.village || loc.city;
      loc.state = a.state || loc.state;
      loc.country = a.country || loc.country;
    } catch (_) {}

    // Optional: fetch weather to refill rainfall/wind/pressure/uv for your dashboard
    let wx = {};
    try {
      const wxr = await axios.get('https://api.open-meteo.com/v1/forecast', {
        params: {
          latitude: loc.lat, longitude: loc.lon,
          current: 'temperature_2m,relative_humidity_2m,pressure_msl,wind_speed_10m,uv_index',
          daily: 'precipitation_sum',
          timezone: 'auto'
        }
      });
      const cur = wxr.data?.current || {};
      const daily = wxr.data?.daily || {};
      wx = {
        windSpeed: cur.wind_speed_10m,
        pressure: cur.pressure_msl,
        uvIndex: cur.uv_index,
        rainfall: (daily.precipitation_sum && daily.precipitation_sum[0]) || req.body?.rainfall || 0
      };
    } catch (_) {}

    // Save reading (use wx values to populate dashboard fields)
    const reading = await Reading.create({
      temperature: Number(req.body.temperature),
      humidity: Number(req.body.humidity),
      mq2: Number(req.body.mq2),
      rainfall: Number(wx.rainfall ?? 0),
      windSpeed: Number(wx.windSpeed ?? 0),
      pressure: Number(wx.pressure ?? 0),
      uvIndex: Number(wx.uvIndex ?? 0),
      weatherDescription: getWeatherDescription(Number(req.body.temperature), Number(req.body.humidity)),
      city: loc.city, state: loc.state, country: loc.country, lat: loc.lat, lon: loc.lon,
    });

    res.json({ success: true, message: 'Sensor data saved', data: reading });
  } catch (e) {
    console.error('Error saving ESP32 data:', e);
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
