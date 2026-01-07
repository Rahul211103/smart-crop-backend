import os
import json
import re
import traceback
from flask import Flask, request, jsonify, make_response
from flask_cors import CORS
from dotenv import load_dotenv
import google.generativeai as genai

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app)

# ------------------------------
# CORS preflight handler
# ------------------------------
@app.before_request
def before_request():
    if request.method == 'OPTIONS':
        response = make_response()
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        return response

# ------------------------------
# Configure Gemini API
# ------------------------------
api_key = os.getenv("GOOGLE_GENAI_API_KEY")

if api_key:
    genai.configure(api_key=api_key)
else:
    @app.route('/generate_advisory', methods=['POST'])
    def missing_key():
        return jsonify({"error": "Missing GOOGLE_GENAI_API_KEY"}), 500


# ------------------------------
# Utility: Clean markdown
# ------------------------------
def clean_markdown(md: str) -> str:
    md = re.sub(r'(?m)^\s{0,3}#{1,6}\s*', '', md)
    md = re.sub(r'\*\*(.*?)\*\*', r'\1', md)
    md = re.sub(r'_(.*?)_', r'\1', md)
    md = re.sub(r'`{1,3}([^`]*)`{1,3}', r'\1', md)
    md = re.sub(r'(?m)^\s*[-*•]\s*', '', md)
    md = re.sub(r'(?m)^\s*\d+\.\s*', '', md)
    md = re.sub(r'\n{3,}', '\n\n', md)
    return md.strip()


# ------------------------------
# AI Response Generator
# ------------------------------
def generate_ai_response(prompt: str, model_name: str = "gemini-2.0-flash"):
    try:
        model = genai.GenerativeModel(model_name=model_name)
        response = model.generate_content(prompt)
        text = (getattr(response, "text", "") or "").strip()
        return clean_markdown(text)
    except Exception as e:
        traceback.print_exc()
        return f"AI service temporarily unavailable. Error: {str(e)}"


# ------------------------------
# Utility: Language Tag
# ------------------------------
def language_tag(lang: str) -> str:
    mapping = {
        "en": "Respond in English",
        "hi": "Respond in Hindi (हिन्दी)",
        "kn": "Respond in Kannada (ಕನ್ನಡ)",
        "te": "Respond in Telugu (తెలుగు)",
        "ta": "Respond in Tamil (தமிழ்)"
    }
    return mapping.get(lang, mapping["en"])


# ------------------------------
# Weather Summary
# ------------------------------
@app.route('/summarize_weather', methods=['POST'])
def summarize_weather():
    data = request.json or {}

    city = data.get("city", "")
    state = data.get("state", "")
    country = data.get("country", "")
    lat = data.get("lat")
    lon = data.get("lon")

    temp = data.get("temperature")
    humidity = data.get("humidity")
    rainfall = data.get("rainfall", 0)
    wind = data.get("windSpeed")
    pressure = data.get("pressure")
    uv = data.get("uvIndex")
    lang = data.get("language", "en")

    prompt = f"""
{language_tag(lang)}
Write a concise 1–3 sentence weather summary for farmers in:
City: {city}, State: {state}, Country: {country}, Coordinates: ({lat}, {lon})

Current conditions:
- Temperature: {temp}°C
- Humidity: {humidity}%
- Rainfall: {rainfall} mm
- Wind Speed: {wind} m/s
- Pressure: {pressure} hPa
- UV Index: {uv}

Keep the output plain text. No bullets or markdown.
"""

    text = generate_ai_response(prompt)
    return jsonify({"text": text})


# ------------------------------
# Crop Advisory
# ------------------------------
@app.route("/generate_advisory", methods=["POST"])
def generate_advisory():
    data = request.json or {}

    mode = data.get("mode")
    lang = data.get("language", "en")

    if mode == "weather_summary":
        loc = data.get("location", {})
        city = loc.get("city", "")
        state = loc.get("state", "")
        country = loc.get("country", "")
        lat = loc.get("lat")
        lon = loc.get("lon")

        temp = data.get("temperature")
        humidity = data.get("humidity")
        rainfall = data.get("rainfall", 0)
        wind = data.get("windSpeed")
        pressure = data.get("pressure")
        uv = data.get("uvIndex")

        prompt = f"""
{language_tag(lang)}
Write a 1–3 sentence weather summary for farmers in:
{city}, {state}, {country} ({lat},{lon})

Conditions:
Temperature {temp}°C, Humidity {humidity}%, Rainfall {rainfall}mm,
Wind {wind}, Pressure {pressure}, UV {uv}.
"""

        text = generate_ai_response(prompt)
        return jsonify({"advisory_text": text})

    # Regular crop advisory
    crop = data.get("crop_name", "crop")
    temp = data.get("temperature")
    humidity = data.get("humidity")
    rainfall = data.get("rainfall")
    pollution = data.get("pollution_level", 1)

    if any(v is None for v in (temp, humidity, rainfall)):
        return jsonify({"error": "Missing temperature, humidity, or rainfall"}), 400

    prompt = f"""
Provide farming advice in {lang}.
Generate a personalized advisory for growing {crop}.

Conditions:
Temperature {temp}°C, Humidity {humidity}%, Rainfall {rainfall}mm,
Pollution level {pollution}.

Write plain text only. No bullets.
"""

    text = generate_ai_response(prompt)

    return jsonify({
        "advisory_text": text,
        "advisory_image_url": f"https://example.com/images/{crop.lower()}_advisory.png"
    })


# ------------------------------
# Crop Care Advice
# ------------------------------
@app.route("/crop_care_advice", methods=["POST"])
def crop_care_advice():
    data = request.json or {}

    crop = data.get("crop_name")
    temp = data.get("temperature")
    humidity = data.get("humidity")
    rainfall = data.get("rainfall")
    mq2 = data.get("mq2", 0)
    stage = data.get("growth_stage", "vegetative")
    lang = data.get("language", "en")

    if any(v is None for v in (crop, temp, humidity, rainfall)):
        return jsonify({"error": "Missing required fields"}), 400

    prompt = f"""
Provide detailed farming guidance in {lang}.
Crop: {crop}, Stage: {stage}
Conditions: Temp {temp}°C, Humidity {humidity}%, Rainfall {rainfall}mm, MQ2 {mq2}

Explain:
- Immediate actions (24–48h)
- Weekly schedule
- Pest/disease prevention
- Nutrients
- Weather precautions
"""

    ai_text = generate_ai_response(prompt)

    return jsonify({
        "success": True,
        "advice": {
            "crop": crop,
            "growthStage": stage,
            "aiRecommendations": ai_text
        }
    })


# ------------------------------
# Educational Videos
# ------------------------------
@app.route("/get_educational_videos", methods=["POST"])
def get_educational_videos():
    data = request.json or {}
    crop = data.get("crop_name", "general")
    stage = data.get("growth_stage", "vegetative")

    return jsonify({
        "success": True,
        "videos": [
            {
                "title": f"{crop.title()} Growing Guide",
                "description": "Beginner-friendly instructions",
                "search_terms": f"{crop} farming guide",
                "category": "Crop Care"
            },
            {
                "title": "Smart Agriculture Techniques",
                "description": "Modern farming methods",
                "search_terms": "smart agriculture",
                "category": "Smart Farming"
            }
        ]
    })


# ------------------------------
# Chatbot
# ------------------------------
@app.route('/chatbot', methods=['POST'])
def chatbot():
    try:
        data = request.json or {}
        message = data.get("message", "")
        lang = data.get("language", "en")

        if not message:
            return jsonify({"success": False, "error": "Message required"}), 400

        instruction = {
            "en": "You are an expert farming advisor.",
            "hi": "आप एक विशेषज्ञ कृषि सलाहकार हैं।",
            "kn": "ನೀವು ತಜ್ಞ ಕೃಷಿ ಸಲಹೆಗಾರರು.",
            "te": "మీరు నిపుణ రైతుల సలహాదారులు.",
            "ta": "நீங்கள் நிபுண விவசாய ஆலோசகர்."
        }.get(lang, "You are an expert farming advisor.")

        prompt = f"""
{instruction}
Question: {message}
Give a practical, helpful farming answer.
"""

        reply = generate_ai_response(prompt)

        return jsonify({"success": True, "reply": reply, "language": lang})

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ------------------------------
# Start Server
# ------------------------------
if __name__ == "__main__":
    port = int(os.getenv("PORT", 5003))
    app.run(host="0.0.0.0", port=port, debug=False)

