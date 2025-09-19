require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const MongoStore = require('connect-mongo');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: true, credentials: true }));
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
    weatherDescription: { type: String },
    city: String,
    state: String,
    country: String,
  },
  { timestamps: true }
);
const Reading = mongoose.model('Reading', readingSchema);

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
    const { temperature, humidity, mq2 } = req.body || {};
    if (temperature == null || humidity == null || mq2 == null) {
      return res.status(400).json({ success: false, message: 'Missing required sensor data' });
    }

    const reading = await Reading.create({
      temperature: Number(temperature),
      humidity: Number(humidity),
      mq2: Number(mq2),
      weatherDescription: getWeatherDescription(Number(temperature), Number(humidity)),
      city: process.env.LOCATION_CITY || 'Mumbai',
      state: process.env.LOCATION_STATE || 'Maharashtra',
      country: process.env.LOCATION_COUNTRY || 'India',
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

// AI endpoints (mocked)
app.post('/predict', async (req, res) => {
  try {
    const mockPredictions = ['rice', 'maize', 'chickpea', 'kidneybeans', 'wheat', 'cotton'];
    res.json({ prediction: mockPredictions[Math.floor(Math.random() * mockPredictions.length)] });
  } catch (e) {
    res.status(500).json({ error: 'Prediction failed', details: e.message });
  }
});

app.post('/generate_advisory', async (req, res) => {
  try {
    const { crop_name, temperature, humidity, rainfall, pollution_level } = req.body || {};
    const advisoryText = `Based on current conditions (Temperature: ${temperature}°C, Humidity: ${humidity}%, Rainfall: ${rainfall}mm), here are recommendations for ${crop_name} cultivation:

1. ${humidity < 50 ? 'Increase irrigation frequency' : 'Maintain current irrigation schedule'}
2. ${temperature > 30 ? 'Provide shade or cooling measures' : 'Temperature is optimal for growth'}
3. ${rainfall > 50 ? 'Reduce irrigation to prevent waterlogging' : 'Monitor soil moisture levels'}
4. Air quality level ${pollution_level} – ${pollution_level > 3 ? 'consider protective measures' : 'conditions are favorable'}`;

    res.json({
      advisory_text: advisoryText,
      advisory_image_url: `https://example.com/images/${(crop_name || '').replace(/\s+/g, '_').toLowerCase()}_advisory.png`,
    });
  } catch (e) {
    res.status(500).json({ error: 'Advisory generation failed', details: e.message });
  }
});

app.post('/get_educational_videos', async (req, res) => {
  try {
    const { crop_name, temperature, humidity, rainfall, growth_stage } = req.body || {};
    res.json({
      success: true,
      videos: [
        { title: `${crop_name || 'Crop'} Farming Guide`, description: `Complete guide for ${crop_name || 'crop'} in ${growth_stage || 'vegetative'} stage`, category: 'Crop Care', search_terms: `${crop_name || 'agriculture'} ${growth_stage || 'farming'} guide`, relevance_reason: `Based on ${temperature}°C & ${humidity}%` },
        { title: 'Smart Irrigation Techniques', description: 'Efficient watering methods', category: 'Irrigation', search_terms: 'smart irrigation agriculture', relevance_reason: 'Optimize water usage' },
        { title: 'Pest and Disease Management', description: 'Protect crops from pests', category: 'Pest Control', search_terms: `${crop_name || 'crop'} pest control ${growth_stage || 'farming'}`, relevance_reason: 'Preventive measures' },
        { title: 'Weather Monitoring for Farmers', description: 'Weather patterns and impact', category: 'Weather Monitoring', search_terms: 'weather monitoring farming', relevance_reason: 'Crop planning' },
      ],
    });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to get educational videos', details: e.message });
  }
});

app.post('/crop_care_advice', async (req, res) => {
  try {
    const { crop_name, temperature, humidity, rainfall, mq2, growth_stage } = req.body || {};
    res.json({
      success: true,
      advice: {
        crop: crop_name || 'General Crop',
        growthStage: growth_stage || 'vegetative',
        immediateActions: [
          `Monitor ${crop_name || 'crop'} in ${growth_stage || 'vegetative'} stage`,
          `Check soil moisture (humidity: ${humidity}%)`,
          `Observe for pest signs (Air quality: ${mq2 ?? 'N/A'})`,
          `Adjust irrigation (rainfall: ${rainfall ?? 0}mm)`,
        ],
        aiRecommendations: `Given ${temperature}°C, ${humidity}% humidity, ${rainfall}mm rainfall, and air quality ${mq2 ?? 'N/A'}, follow regular monitoring and timely interventions.`,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to get crop care advice', details: e.message });
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
