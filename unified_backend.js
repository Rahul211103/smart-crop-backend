require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const SimpleWeatherService = require('./simple_weather_service');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true, 
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected for unified backend'))
.catch(err => {
  console.error('MongoDB connection error:', err);
  process.exit(1);
});

// Configure session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'demo_secret_key_for_final_year_project',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
  cookie: {
    maxAge: 1000 * 60 * 60 * 24, // 1 day
    httpOnly: true,
    secure: false
  }
}));

// Initialize simple weather service
const weatherService = new SimpleWeatherService();

// User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  email: { type: String, required: true }
});

const User = mongoose.model('User', userSchema);

// ===== AUTHENTICATION ENDPOINTS =====
// Register Route
app.post('/register', async (req, res) => {
  const { username, password, email } = req.body;
  if (!username || !password || !email)
    return res.status(400).json({ message: 'Username, password, and email required' });

  try {
    const exists = await User.findOne({ username });
    if (exists) return res.status(409).json({ message: 'Username already exists' });

    const hashed = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashed, email });
    await newUser.save();

    res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Login Route
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ message: 'Username and password required' });

  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ message: 'Invalid username or password' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ message: 'Invalid username or password' });

    req.session.userId = user._id;
    req.session.username = user.username;

    res.json({ message: 'Login successful' });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ===== ESP32 DATA COLLECTION ENDPOINTS =====
// ESP32 can send data directly to this endpoint
app.post('/api/sensor-data', async (req, res) => {
  try {
    const { temperature, humidity, mq2 } = req.body;
    
    // Validate data
    if (temperature == null || humidity == null || mq2 == null) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required sensor data' 
      });
    }

    // Generate weather data and store
    const weatherData = await weatherService.updateSensorDataWithWeather({
      temperature,
      humidity,
      mq2
    });

    console.log('📊 Received ESP32 data:', { temperature, humidity, mq2 });
    
    res.json({
      success: true,
      message: 'Sensor data received and processed',
      data: weatherData
    });
  } catch (error) {
    console.error('❌ Error processing ESP32 data:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error processing sensor data',
      error: error.message
    });
  }
});

// Endpoint for ESP32 to check if server is alive
app.get('/api/esp32/status', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Smart Crop Backend is running',
    timestamp: new Date().toISOString()
  });
});

// ===== SENSOR DATA ENDPOINTS =====
app.get('/sensor_data/latest', async (req, res) => {
  try {
    const data = await weatherService.getWeatherHistory(1);
    if (!data || data.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'No sensor data found' 
      });
    }
    res.json({
      success: true,
      data: data[0]
    });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching latest sensor data', 
      error: err.message 
    });
  }
});

app.get('/sensor_data', async (req, res) => {
  try {
    const data = await weatherService.getWeatherHistory(50);
    res.json({
      success: true,
      count: data.length,
      data: data
    });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching sensor data', 
      error: err.message 
    });
  }
});

app.get('/sensor_data/stats', async (req, res) => {
  try {
    const stats = await weatherService.getWeatherStats();
    res.json({
      success: true,
      stats: stats
    });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching sensor statistics', 
      error: err.message 
    });
  }
});

// ===== ML PREDICTION ENDPOINTS =====
app.post('/predict', async (req, res) => {
  try {
    const { temperature, humidity, rainfall } = req.body;
    
    // For deployment, we'll use a mock prediction since we can't run Python on Render
    // In production, you'd deploy the Python ML API separately
    const mockPredictions = ['rice', 'maize', 'chickpea', 'kidneybeans', 'wheat', 'cotton'];
    const randomPrediction = mockPredictions[Math.floor(Math.random() * mockPredictions.length)];
    
    res.json({ prediction: randomPrediction });
  } catch (error) {
    res.status(500).json({ error: 'Prediction failed', details: error.message });
  }
});

// ===== ADVISORY ENDPOINTS =====
app.post('/generate_advisory', async (req, res) => {
  try {
    const { crop_name, temperature, humidity, rainfall, pollution_level, language } = req.body;
    
    // Mock advisory generation for deployment
    const advisoryText = `Based on current conditions (Temperature: ${temperature}°C, Humidity: ${humidity}%, Rainfall: ${rainfall}mm), here are recommendations for ${crop_name} cultivation:

1. **Irrigation Management**: ${humidity < 50 ? 'Increase irrigation frequency' : 'Maintain current irrigation schedule'}
2. **Temperature Control**: ${temperature > 30 ? 'Provide shade or cooling measures' : 'Temperature is optimal for growth'}
3. **Rainfall Consideration**: ${rainfall > 50 ? 'Reduce irrigation to prevent waterlogging' : 'Monitor soil moisture levels'}
4. **Pollution Impact**: Air quality level ${pollution_level} - ${pollution_level > 3 ? 'Consider protective measures' : 'Conditions are favorable'}

These recommendations are based on current sensor readings and agricultural best practices.`;

    res.json({
      advisory_text: advisoryText,
      advisory_image_url: `https://example.com/images/${crop_name?.replace(' ', '_').toLowerCase()}_advisory.png`
    });
  } catch (error) {
    res.status(500).json({
      error: 'Advisory generation failed',
      details: error.message
    });
  }
});

// ===== EDUCATIONAL VIDEOS ENDPOINT =====
app.post('/get_educational_videos', async (req, res) => {
  try {
    const { crop_name, temperature, humidity, rainfall, growth_stage, language } = req.body;
    
    const videos = [
      {
        title: `${crop_name || 'Crop'} Farming Guide`,
        description: `Complete guide for ${crop_name || 'crop'} cultivation in ${growth_stage || 'vegetative'} stage`,
        category: 'Crop Care',
        search_terms: `${crop_name || 'agriculture'} ${growth_stage || 'farming'} guide`,
        relevance_reason: `Based on current temperature ${temperature}°C and humidity ${humidity}%`
      },
      {
        title: 'Smart Irrigation Techniques',
        description: 'Learn efficient watering methods for your crops',
        category: 'Irrigation',
        search_terms: 'smart irrigation agriculture',
        relevance_reason: 'Optimize water usage based on current conditions'
      },
      {
        title: 'Pest and Disease Management',
        description: 'Protect your crops from common pests and diseases',
        category: 'Pest Control',
        search_terms: `${crop_name || 'crop'} pest control ${growth_stage || 'farming'}`,
        relevance_reason: 'Preventive measures for current growth stage'
      },
      {
        title: 'Weather Monitoring for Farmers',
        description: 'Understanding weather patterns and their impact on crops',
        category: 'Weather Monitoring',
        search_terms: 'weather monitoring farming',
        relevance_reason: 'Important for crop planning and management'
      }
    ];

    res.json({
      success: true,
      videos: videos
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get educational videos',
      details: error.message
    });
  }
});

// ===== CROP CARE ADVICE ENDPOINT =====
app.post('/crop_care_advice', async (req, res) => {
  try {
    const { crop_name, temperature, humidity, rainfall, mq2, growth_stage, language } = req.body;
    
    const advice = {
      crop: crop_name || 'General Crop',
      growthStage: growth_stage || 'vegetative',
      immediateActions: [
        `Monitor ${crop_name || 'crop'} growth in ${growth_stage || 'vegetative'} stage`,
        `Check soil moisture levels (Current humidity: ${humidity}%)`,
        `Observe for pest signs (Air quality: ${mq2 || 'N/A'})`,
        `Adjust irrigation based on rainfall: ${rainfall || 0}mm`
      ],
      aiRecommendations: `Based on current conditions (${temperature}°C, ${humidity}% humidity, ${rainfall}mm rainfall), your ${crop_name || 'crop'} in ${growth_stage || 'vegetative'} stage needs careful monitoring. The air quality reading of ${mq2 || 'N/A'} suggests ${(mq2 && mq2 > 500) ? 'poor' : 'good'} air quality conditions. Regular monitoring and timely interventions will ensure healthy crop growth.`
    };

    res.json({
      success: true,
      advice: advice
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get crop care advice',
      details: error.message
    });
  }
});

// ===== HEALTH CHECK AND ROOT ENDPOINTS =====
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Unified Smart Crop Backend Server',
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.json({
    message: 'Smart Crop Advisor Unified Backend',
    version: '1.0.0',
    endpoints: {
      'POST /register': 'User registration',
      'POST /login': 'User login',
      'GET /sensor_data/latest': 'Get latest sensor data',
      'POST /api/sensor-data': 'ESP32 sensor data endpoint',
      'GET /api/esp32/status': 'ESP32 status check',
      'POST /predict': 'Get crop recommendation',
      'POST /generate_advisory': 'Get farming advisory',
      'POST /get_educational_videos': 'Get AI-recommended videos',
      'POST /crop_care_advice': 'Get crop care advice',
      'GET /health': 'Health check'
    }
  });
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Unified Smart Crop Backend running on http://localhost:${PORT}`);
  console.log(`📊 All endpoints available on single server`);
  console.log(`🌍 Using Simple Weather Service for sensor data`);
  console.log(`📡 ESP32 can send data to: /api/sensor-data`);
  console.log(`📍 Location: ${process.env.LOCATION_CITY || 'Mumbai'}, ${process.env.LOCATION_COUNTRY || 'India'}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down unified backend server...');
  process.exit(0);
});