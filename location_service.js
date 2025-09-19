// backend/location_service.js
require('dotenv').config();
const axios = require('axios');

class LocationService {
  constructor() {
    this.nominatimURL = 'https://nominatim.openstreetmap.org';
    this.locationCache = new Map();
    this.cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours cache
  }

  // Get location from IP address (free service)
  async getLocationFromIP() {
    try {
      console.log('🌍 Detecting location from IP address...');
      
      const response = await axios.get('http://ip-api.com/json/', {
        timeout: 5000,
        headers: {
          'User-Agent': 'SmartCropAdvisor/1.0'
        }
      });

      if (response.data.status === 'success') {
        const data = response.data;
        const location = {
          lat: parseFloat(data.lat),
          lon: parseFloat(data.lon),
          city: data.city,
          country: data.country,
          state: data.regionName,
          countryCode: data.countryCode,
          timezone: data.timezone
        };

        console.log(`✅ Location detected via IP: ${data.city}, ${data.country} (${data.lat}, ${data.lon})`);
        return location;
      }
      
      throw new Error('IP location detection failed');
    } catch (error) {
      console.error('❌ Error getting location from IP:', error.message);
      throw error;
    }
  }

  // Search location by city name using OpenStreetMap Nominatim
  async searchLocationByCity(cityName) {
    try {
      console.log(`�� Searching for location: ${cityName}`);
      
      // Check cache first
      const cacheKey = `city_${cityName.toLowerCase()}`;
      if (this.locationCache.has(cacheKey)) {
        const cached = this.locationCache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.cacheExpiry) {
          console.log(`�� Using cached location: ${cached.city}, ${cached.country}`);
          return cached;
        }
      }

      const response = await axios.get(`${this.nominatimURL}/search`, {
        params: {
          q: cityName,
          format: 'json',
          addressdetails: 1,
          limit: 1
        },
        timeout: 10000,
        headers: {
          'User-Agent': 'SmartCropAdvisor/1.0'
        }
      });

      if (response.data && response.data.length > 0) {
        const data = response.data[0];
        const location = {
          lat: parseFloat(data.lat),
          lon: parseFloat(data.lon),
          city: data.address?.city || data.address?.town || data.address?.village || cityName,
          country: data.address?.country || 'Unknown',
          state: data.address?.state || data.address?.county || 'Unknown',
          countryCode: data.address?.country_code || 'unknown',
          displayName: data.display_name
        };

        // Cache the result
        this.locationCache.set(cacheKey, {
          ...location,
          timestamp: Date.now()
        });

        console.log(`✅ Location found: ${location.city}, ${location.country} (${location.lat}, ${location.lon})`);
        return location;
      }
      
      throw new Error('Location not found');
    } catch (error) {
      console.error('❌ Error searching location:', error.message);
      throw error;
    }
  }

  // Reverse geocoding - get location from coordinates
  async getLocationFromCoords(lat, lon) {
    try {
      console.log(`�� Getting location from coordinates: ${lat}, ${lon}`);
      
      const cacheKey = `coords_${lat}_${lon}`;
      if (this.locationCache.has(cacheKey)) {
        const cached = this.locationCache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.cacheExpiry) {
          console.log(`�� Using cached location: ${cached.city}, ${cached.country}`);
          return cached;
        }
      }

      const response = await axios.get(`${this.nominatimURL}/reverse`, {
        params: {
          lat: lat,
          lon: lon,
          format: 'json',
          addressdetails: 1
        },
        timeout: 10000,
        headers: {
          'User-Agent': 'SmartCropAdvisor/1.0'
        }
      });

      if (response.data) {
        const data = response.data;
        const location = {
          lat: parseFloat(data.lat),
          lon: parseFloat(data.lon),
          city: data.address?.city || data.address?.town || data.address?.village || 'Unknown',
          country: data.address?.country || 'Unknown',
          state: data.address?.state || data.address?.county || 'Unknown',
          countryCode: data.address?.country_code || 'unknown',
          displayName: data.display_name
        };

        // Cache the result
        this.locationCache.set(cacheKey, {
          ...location,
          timestamp: Date.now()
        });

        console.log(`✅ Location found: ${location.city}, ${location.country} (${location.lat}, ${location.lon})`);
        return location;
      }
      
      throw new Error('Reverse geocoding failed');
    } catch (error) {
      console.error('❌ Error getting location from coordinates:', error.message);
      throw error;
    }
  }

  // Auto-detect location with fallback options
  async autoDetectLocation() {
    try {
      // Try IP-based detection first
      return await this.getLocationFromIP();
    } catch (ipError) {
      console.log('⚠️  IP detection failed, trying fallback...');
      
      try {
        // Fallback to default location from environment
        const defaultLat = parseFloat(process.env.LOCATION_LAT || 19.0760);
        const defaultLon = parseFloat(process.env.LOCATION_LON || 72.8777);
        
        return await this.getLocationFromCoords(defaultLat, defaultLon);
      } catch (coordError) {
        console.log('⚠️  Coordinate fallback failed, using hardcoded default...');
        
        // Final fallback
        return {
          lat: 19.0760,
          lon: 72.8777,
          city: 'Mumbai',
          country: 'India',
          state: 'Maharashtra',
          countryCode: 'in',
          displayName: 'Mumbai, Maharashtra, India'
        };
      }
    }
  }

  // Get multiple location suggestions for a city
  async searchLocationSuggestions(query, limit = 5) {
    try {
      console.log(`🔍 Getting location suggestions for: ${query}`);
      
      const response = await axios.get(`${this.nominatimURL}/search`, {
        params: {
          q: query,
          format: 'json',
          addressdetails: 1,
          limit: limit
        },
        timeout: 10000,
        headers: {
          'User-Agent': 'SmartCropAdvisor/1.0'
        }
      });

      if (response.data && response.data.length > 0) {
        const suggestions = response.data.map(item => ({
          lat: parseFloat(item.lat),
          lon: parseFloat(item.lon),
          city: item.address?.city || item.address?.town || item.address?.village || 'Unknown',
          country: item.address?.country || 'Unknown',
          state: item.address?.state || item.address?.county || 'Unknown',
          countryCode: item.address?.country_code || 'unknown',
          displayName: item.display_name
        }));

        console.log(`✅ Found ${suggestions.length} location suggestions`);
        return suggestions;
      }
      
      return [];
    } catch (error) {
      console.error('❌ Error getting location suggestions:', error.message);
      return [];
    }
  }

  // Clear cache
  clearCache() {
    this.locationCache.clear();
    console.log('🗑️  Location cache cleared');
  }

  // Get cache stats
  getCacheStats() {
    return {
      size: this.locationCache.size,
      entries: Array.from(this.locationCache.keys())
    };
  }
}

module.exports = LocationService;
