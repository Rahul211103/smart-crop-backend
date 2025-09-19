// Simple weather service for Render deployment
require('dotenv').config();
const axios = require('axios');

class SimpleWeatherService {
  constructor() {
    this.location = {
      lat: process.env.LOCATION_LAT || 19.0760,
      lon: process.env.LOCATION_LON || 72.8777,
      city: process.env.LOCATION_CITY || 'Mumbai',
      country: process.env.LOCATION_COUNTRY || 'India',
      state: process.env.LOCATION_STATE || 'Maharashtra'
    };
  }

  // Generate mock weather data for deployment
  generateMockWeatherData(sensorData) {
    const { temperature, humidity, mq2 } = sensorData;
    
    // Generate realistic weather data based on sensor readings
    const weatherData = {
      temperature: temperature,
      humidity: humidity,
      mq2: mq2,
      rainfall: Math.random() * 20, // 0-20mm
      windSpeed: Math.random() * 10 + 2, // 2-12 m/s
      pressure: 1013 + Math.random() * 20 - 10, // 1003-1023 hPa
      uvIndex: Math.random() * 8 + 2, // 2-10
      weatherDescription: this.getWeatherDescription(temperature, humidity),
      city: this.location.city,
      country: this.location.country,
      state: this.location.state,
      latitude: this.location.lat,
      longitude: this.location.lon,
      timestamp: new Date().toISOString()
    };

    return weatherData;
  }

  getWeatherDescription(temp, humidity) {
    if (temp < 15) return 'Cold';
    if (temp < 25) return 'Cool';
    if (temp < 35) return 'Warm';
    if (humidity > 80) return 'Humid';
    if (humidity < 30) return 'Dry';
    return 'Pleasant';
  }

  // Mock method to get weather history
  async getWeatherHistory(limit = 1) {
    // Generate mock historical data
    const mockData = [];
    for (let i = 0; i < limit; i++) {
      const sensorData = {
        temperature: 20 + Math.random() * 20, // 20-40°C
        humidity: 40 + Math.random() * 40, // 40-80%
        mq2: 100 + Math.random() * 400 // 100-500
      };
      
      mockData.push(this.generateMockWeatherData(sensorData));
    }
    
    return mockData;
  }

  // Mock method to get weather stats
  async getWeatherStats() {
    return {
      avgTemperature: 28.5,
      avgHumidity: 65.2,
      avgRainfall: 5.8,
      totalReadings: 100
    };
  }

  // Mock method to update sensor data
  async updateSensorDataWithWeather(sensorData) {
    // In production, this would save to database
    console.log('📊 Mock weather data generated for:', sensorData);
    return this.generateMockWeatherData(sensorData);
  }
}

module.exports = SimpleWeatherService;
