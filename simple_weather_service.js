// d:\SCRS\backend\simple_weather_service.js
// Simple weather utility (not used by unified_backend now)
require('dotenv').config();

class SimpleWeatherService {
  constructor() {
    this.location = {
      lat: parseFloat(process.env.LOCATION_LAT || '19.0760'),
      lon: parseFloat(process.env.LOCATION_LON || '72.8777'),
      city: process.env.LOCATION_CITY || 'Mumbai',
      country: process.env.LOCATION_COUNTRY || 'India',
      state: process.env.LOCATION_STATE || 'Maharashtra',
    };
  }

  generateMockWeatherData(sensorData) {
    const temperature = Number(sensorData.temperature);
    const humidity = Number(sensorData.humidity);
    const mq2 = Number(sensorData.mq2);

    return {
      temperature,
      humidity,
      mq2,
      rainfall: Number((Math.random() * 20).toFixed(1)),
      windSpeed: Number((Math.random() * 10 + 2).toFixed(1)),
      pressure: Math.round(1013 + (Math.random() * 20 - 10)),
      uvIndex: Number((Math.random() * 8 + 2).toFixed(1)),
      weatherDescription: this.getWeatherDescription(temperature, humidity),
      city: this.location.city,
      country: this.location.country,
      state: this.location.state,
      latitude: this.location.lat,
      longitude: this.location.lon,
      timestamp: new Date().toISOString(),
    };
  }

  getWeatherDescription(temp, humidity) {
    if (isNaN(temp) || isNaN(humidity)) return 'Unknown';
    if (temp < 15) return 'Cold';
    if (temp < 25) return 'Cool';
    if (temp < 35) return 'Warm';
    if (humidity > 80) return 'Humid';
    if (humidity < 30) return 'Dry';
    return 'Pleasant';
  }

  async getWeatherHistory(limit = 1) {
    const out = [];
    for (let i = 0; i < limit; i++) {
      const sensorData = {
        temperature: Number((20 + Math.random() * 20).toFixed(1)),
        humidity: Number((40 + Math.random() * 40).toFixed(1)),
        mq2: Math.round(100 + Math.random() * 400),
      };
      out.push(this.generateMockWeatherData(sensorData));
    }
    return out;
  }

  async getWeatherStats() {
    return {
      avgTemperature: 28.5,
      avgHumidity: 65.2,
      avgRainfall: 5.8,
      totalReadings: 100,
    };
  }

  async updateSensorDataWithWeather(sensorData) {
    // kept silent; no console logs
    return this.generateMockWeatherData(sensorData);
  }
}

module.exports = SimpleWeatherService;
