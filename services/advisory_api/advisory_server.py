import os
import json
import re
import traceback
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import google.generativeai as genai

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app)

# Configure Gemini AI
api_key = os.getenv('GOOGLE_GENAI_API_KEY')
if not api_key:
    @app.route('/generate_advisory', methods=['POST'])
    def missing_key():
        return jsonify({"error": "Missing GOOGLE_GENAI_API_KEY"}), 500
else:
    genai.configure(api_key=api_key)

def clean_markdown(md: str) -> str:
    """Clean markdown formatting from AI responses"""
    md = re.sub(r'(?m)^\s{0,3}#{1,6}\s*', '', md)  # Remove headings
    md = re.sub(r'\*\*(.*?)\*\*', r'\1', md)       # Remove bold
    md = re.sub(r'_(.*?)_', r'\1', md)             # Remove italic
    md = re.sub(r'`{1,3}([^`]*)`{1,3}', r'\1', md) # Remove code blocks
    md = re.sub(r'(?m)^\s*[-*•]\s*', '', md)       # Remove bullets
    md = re.sub(r'(?m)^\s*\d+\.\s*', '', md)       # Remove numbered lists
    md = re.sub(r'\n{3,}', '\n\n', md)             # Collapse extra blank lines
    return md.strip()

def generate_ai_response(prompt: str, model_name: str = 'gemini-2.0-flash-exp') -> str:
    try:
        model = genai.GenerativeModel(model_name=model_name)
        response = model.generate_content(prompt)
        text = (getattr(response, 'text', '') or '').strip()
        return clean_markdown(text)
    except Exception as e:
        traceback.print_exc()
        return f"AI service temporarily unavailable. Error: {str(e)}"

def language_tag(lang: str) -> str:
    mp = {
        'en': 'Respond in English',
        'hi': 'Respond in Hindi (हिन्दी)',
        'kn': 'Respond in Kannada (ಕನ್ನಡ)',
        'te': 'Respond in Telugu (తెలుగు)',
        'ta': 'Respond in Tamil (தமிழ்)',
    }
    return mp.get(lang or 'en', mp['en'])

# 1) Weather summary endpoint (for unified backend weatherDescription)
@app.route('/summarize_weather', methods=['POST'])
def summarize_weather():
    data = request.json or {}
    # Inputs (most optional except temp/humidity ideally present)
    city = data.get('city', '')
    state = data.get('state', '')
    country = data.get('country', '')
    lat = data.get('lat')
    lon = data.get('lon')

    temp = data.get('temperature')      # °C
    humidity = data.get('humidity')     # %
    rainfall = data.get('rainfall', 0)  # mm
    wind = data.get('windSpeed')        # m/s
    pressure = data.get('pressure')     # hPa
    uv = data.get('uvIndex')            # index
    lang = data.get('language', 'en')

    # Short, 1–3 sentences summary
    prompt = f"""
{language_tag(lang)}
Write a concise 1–3 sentence weather summary for farmers in:
City: {city}, State: {state}, Country: {country}, Coordinates: ({lat}, {lon})

Current conditions:
- Temperature: {temp}°C
- Humidity: {humidity}%
- Rainfall (today): {rainfall} mm
- Wind Speed: {wind} m/s
- Pressure: {pressure} hPa
- UV Index: {uv}

Keep it plain text (no bullets, no markdown), easy to read, practical, and neutral. Mention likely comfort/heat/cold and any caution if rainfall, wind or UV looks notable.
"""
    text = generate_ai_response(prompt)
    return jsonify({ "text": text })

# 2) Existing endpoints (unchanged behavior), with optional mode=weather_summary
@app.route('/generate_advisory', methods=['POST'])
def generate_advisory():
    """Original crop recommendation / advisory endpoint (now supports mode=weather_summary)"""
    data = request.json or {}

    # New: allow a weather_summary mode through same endpoint if you prefer one call path
    mode = data.get('mode')
    if mode == 'weather_summary':
        # Accepts same fields as /summarize_weather (plus any others)
        city = data.get('location', {}).get('city', '')
        state = data.get('location', {}).get('state', '')
        country = data.get('location', {}).get('country', '')
        lat = data.get('location', {}).get('lat')
        lon = data.get('location', {}).get('lon')

        temp = data.get('temperature')
        humidity = data.get('humidity')
        rainfall = data.get('rainfall', 0)
        wind = data.get('windSpeed')
        pressure = data.get('pressure')
        uv = data.get('uvIndex')
        lang = data.get('language', 'en')

        prompt = f"""
{language_tag(lang)}
Write a concise 1–3 sentence weather summary for farmers in:
City: {city}, State: {state}, Country: {country}, Coordinates: ({lat}, {lon})

Current conditions:
- Temperature: {temp}°C
- Humidity: {humidity}%
- Rainfall (today): {rainfall} mm
- Wind Speed: {wind} m/s
- Pressure: {pressure} hPa
- UV Index: {uv}

Keep it plain text (no bullets, no markdown), easy to read, practical, and neutral. Mention likely comfort/heat/cold and any caution if rainfall, wind or UV looks notable.
"""
        text = generate_ai_response(prompt)
        return jsonify({ "advisory_text": text })

    # Default behavior (your original advisory)
    crop = data.get('crop_name', 'crop')
    temp = data.get('temperature')
    humidity = data.get('humidity')
    rainfall = data.get('rainfall')
    pollution = data.get('pollution_level', 1)
    language = data.get('language', 'en')

    # Validate required inputs
    if any(v is None for v in (temp, humidity, rainfall)):
        return jsonify({"error": "Missing temperature, humidity, or rainfall"}), 400

    language_prompts = {
        'en': 'Provide farming advice in English',
        'hi': 'Provide farming advice in Hindi (हिन्दी)',
        'kn': 'Provide farming advice in Kannada (ಕನ್ನಡ)',
        'te': 'Provide farming advice in Telugu (తెలుగు)',
        'ta': 'Provide farming advice in Tamil (தமிழ்)',
    }

    prompt = f"""
{language_prompts.get(language, language_prompts['en'])}

Generate a personalized advisory for growing {crop} with:
- Temperature: {temp}°C
- Humidity: {humidity}%
- Rainfall: {rainfall}mm
- Pollution level: {pollution}

Provide plain text only (no markdown, no bullets, no numbered lists).
Write short paragraphs with clear sentences covering crop care, irrigation,
nutrients, weed/pest management, and practical tips.
"""
    advisory_text = generate_ai_response(prompt)
    advisory_image_url = f"https://example.com/images/{crop.replace(' ', '_').lower()}_advisory.png"

    return jsonify({
        "advisory_text": advisory_text,
        "advisory_image_url": advisory_image_url
    })

@app.route('/crop_care_advice', methods=['POST'])
def crop_care_advice():
    """Enhanced crop care advice with multi-language support"""
    data = request.json or {}
    crop_name = data.get('crop_name')
    temp = data.get('temperature')
    humidity = data.get('humidity')
    rainfall = data.get('rainfall')
    mq2 = data.get('mq2', 0)
    growth_stage = data.get('growth_stage', 'vegetative')
    language = data.get('language', 'en')

    # Validate required inputs
    if any(v is None for v in (crop_name, temp, humidity, rainfall)):
        return jsonify({"error": "Missing required fields"}), 400

    language_prompts = {
        'en': 'Provide farming advice in English',
        'hi': 'Provide farming advice in Hindi (हिन्दी)',
        'kn': 'Provide farming advice in Kannada (ಕನ್ನಡ)',
        'te': 'Provide farming advice in Telugu (తెలుగు)',
        'ta': 'Provide farming advice in Tamil (தமிழ்)',
    }

    prompt = f"""
{language_prompts.get(language, language_prompts['en'])}

As an expert agricultural advisor, provide specific care recommendations for {crop_name} crops that are currently in the {growth_stage} stage.

Current Environmental Conditions:
- Temperature: {temp}°C
- Humidity: {humidity}%
- Rainfall: {rainfall}mm
- Air Quality (MQ2): {mq2}

Please provide:
1. Immediate actions needed (next 24-48 hours)
2. Weekly care schedule
3. Pest and disease prevention measures
4. Nutrient management recommendations
5. Weather adaptation strategies

Format as clear, actionable advice for farmers in the selected language.
"""
    ai_advice = generate_ai_response(prompt)

    advice = {
        'crop': crop_name,
        'growthStage': growth_stage,
        'immediateActions': [
            f"Monitor {crop_name} growth in {growth_stage} stage",
            "Check soil moisture levels",
            "Observe for pest signs"
        ],
        'aiRecommendations': ai_advice
    }

    return jsonify({
        "success": True,
        "advice": advice
    })

@app.route('/get_educational_videos', methods=['POST'])
def get_educational_videos():
    """AI-generated YouTube educational content"""
    data = request.json or {}
    crop_name = data.get('crop_name', 'general')
    temperature = data.get('temperature')
    humidity = data.get('humidity')
    rainfall = data.get('rainfall')
    growth_stage = data.get('growth_stage', 'vegetative')
    language = data.get('language', 'en')

    language_prompts = {
        'en': 'Provide video recommendations in English',
        'hi': 'Provide video recommendations in Hindi (हिन्दी)',
        'kn': 'Provide video recommendations in Kannada (ಕನ್ನಡ)',
        'te': 'Provide video recommendations in Telugu (తెలుగు)',
        'ta': 'Provide video recommendations in Tamil (தமிழ்)',
    }

    prompt = f"""
{language_prompts.get(language, language_prompts['en'])}

Based on the following agricultural conditions, suggest 4 relevant YouTube educational videos for farmers:

Current Conditions:
- Crop: {crop_name}
- Growth Stage: {growth_stage}
- Temperature: {temperature}°C
- Humidity: {humidity}%
- Rainfall: {rainfall}mm

Please provide 4 specific YouTube video recommendations with:
1. Video title
2. Brief description of why it's relevant
3. Suggested YouTube video ID or search terms
4. Category (Smart Farming, Crop Care, Soil Management, Weather Monitoring, Pest Control, Irrigation, etc.)

Format the response as a JSON array with objects containing: title, description, search_terms, category, relevance_reason
"""
    ai_response = generate_ai_response(prompt)

    try:
        # Try to parse JSON from AI response
        json_match = re.search(r'\[.*\]', ai_response, re.DOTALL)
        if json_match:
            video_data = json.loads(json_match.group())
        else:
            video_data = _parse_video_recommendations(ai_response)
    except Exception:
        video_data = _get_fallback_videos(crop_name, growth_stage)

    return jsonify({
        "success": True,
        "videos": video_data,
        "generated_for": {
            "crop": crop_name,
            "growth_stage": growth_stage,
            "conditions": {
                "temperature": temperature,
                "humidity": humidity,
                "rainfall": rainfall
            }
        }
    })

def _parse_video_recommendations(text):
    """Parse AI response into structured video data"""
    videos = []
    lines = text.split('\n')
    for line in lines:
        if 'title' in line.lower() or any(word in line.lower() for word in ['video', 'tutorial', 'guide']):
            videos.append({
                'title': line.strip(),
                'description': 'AI-recommended video for current conditions',
                'search_terms': 'smart agriculture ' + line.strip().lower(),
                'category': 'Smart Farming',
                'relevance_reason': 'Recommended based on current sensor data'
            })
            if len(videos) >= 4:
                break
    return videos if videos else _get_fallback_videos('general', 'vegetative')

def _get_fallback_videos(crop_name, growth_stage):
    """Fallback video recommendations when AI fails"""
    return [
        {
            'title': f'{crop_name.title()} Growing Guide',
            'description': f'Complete guide for growing {crop_name} in {growth_stage} stage',
            'search_terms': f'{crop_name} {growth_stage} growing guide',
            'category': 'Crop Care',
            'relevance_reason': 'Based on selected crop and growth stage'
        },
        {
            'title': 'Smart Agriculture Techniques',
            'description': 'Modern farming methods and technology',
            'search_terms': 'smart agriculture technology',
            'category': 'Smart Farming',
            'relevance_reason': 'General agricultural education'
        },
        {
            'title': 'Soil Management Best Practices',
            'description': 'How to maintain healthy soil for better yields',
            'search_terms': 'soil management agriculture',
            'category': 'Soil Management',
            'relevance_reason': 'Essential for all crops'
        },
        {
            'title': 'Weather Monitoring for Farmers',
            'description': 'Understanding weather patterns and their impact',
            'search_terms': 'weather monitoring farming',
            'category': 'Weather Monitoring',
            'relevance_reason': 'Important for crop planning'
        }
    ]

@app.route('/available_crops', methods=['GET'])
def get_available_crops():
    """Get available crops (fallback if advanced_advisory_service fails)"""
    try:
        from advanced_advisory_service import AdvancedAdvisoryService
        advisory_service = AdvancedAdvisoryService()
        crops = advisory_service.getAvailableCrops()
        return jsonify({"success": True, "crops": crops})
    except Exception as e:
        # Fallback crops
        fallback_crops = [
            {"id": "rice", "name": "Rice"},
            {"id": "maize", "name": "Maize"},
            {"id": "chickpea", "name": "Chickpea"},
            {"id": "kidneybeans", "name": "Kidney Beans"},
            {"id": "wheat", "name": "Wheat"},
            {"id": "cotton", "name": "Cotton"}
        ]
        return jsonify({"success": True, "crops": fallback_crops})

@app.route('/growth_stages/<crop_name>', methods=['GET'])
def get_growth_stages(crop_name):
    """Get growth stages for a crop (fallback if advanced_advisory_service fails)"""
    try:
        from advanced_advisory_service import AdvancedAdvisoryService
        advisory_service = AdvancedAdvisoryService()
        stages = advisory_service.getGrowthStages(crop_name)
        return jsonify({"success": True, "stages": stages})
    except Exception as e:
        # Fallback stages
        fallback_stages = [
            {"id": "germination", "name": "Germination", "duration": "7-14 days"},
            {"id": "vegetative", "name": "Vegetative", "duration": "30-60 days"},
            {"id": "flowering", "name": "Flowering", "duration": "7-14 days"},
            {"id": "grain_filling", "name": "Grain Filling", "duration": "15-30 days"},
            {"id": "maturity", "name": "Maturity", "duration": "7-14 days"}
        ]
        return jsonify({"success": True, "stages": fallback_stages})

@app.route('/chatbot', methods=['POST'])
def chatbot():
    data = request.get_json() or {}
    message = data.get('message', '')
    user_id = data.get('user_id')   # Optional for context

    prompt = f"Farmer question: {message}\nGive a helpful, clear answer."
    response = generate_ai_response(prompt)
    return jsonify({"reply": response})



if __name__ == '__main__':
    port = int(os.getenv('PORT', 5003))
    app.run(host='0.0.0.0', port=port, debug=False)