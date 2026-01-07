import os
import re
import time
import traceback
from flask import Flask, request, jsonify, make_response
from flask_cors import CORS
from dotenv import load_dotenv
import google.generativeai as genai

# ------------------------------
# Load env
# ------------------------------
load_dotenv()

app = Flask(__name__)
CORS(app)

# ------------------------------
# CORS preflight
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
# Gemini config
# ------------------------------
API_KEY = os.getenv("GOOGLE_GENAI_API_KEY")
if not API_KEY:
    raise RuntimeError("Missing GOOGLE_GENAI_API_KEY")

genai.configure(api_key=API_KEY)

MODEL_NAME = "gemini-2.0-flash"
MODEL = genai.GenerativeModel(model_name=MODEL_NAME)

# ------------------------------
# Simple rate limiter
# ------------------------------
LAST_CALL_TIME = 0
MIN_DELAY = 3  # seconds

# ------------------------------
# Clean markdown
# ------------------------------
def clean_markdown(text: str) -> str:
    text = re.sub(r'(?m)^#{1,6}\s*', '', text)
    text = re.sub(r'\*\*(.*?)\*\*', r'\1', text)
    text = re.sub(r'`([^`]*)`', r'\1', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()

# ------------------------------
# AI response
# ------------------------------
def generate_ai_response(prompt: str) -> str:
    global LAST_CALL_TIME
    now = time.time()

    if now - LAST_CALL_TIME < MIN_DELAY:
        return "Please wait a few seconds before requesting again."

    LAST_CALL_TIME = now

    try:
        response = MODEL.generate_content(prompt)
        text = getattr(response, "text", "")
        return clean_markdown(text or "")
    except Exception as e:
        traceback.print_exc()
        return "AI service temporarily unavailable. Please try later."

# ------------------------------
# Language tag (short)
# ------------------------------
def language_tag(lang: str) -> str:
    return {
        "en": "Reply in English.",
        "hi": "हिन्दी में उत्तर दें।",
        "kn": "ಕನ್ನಡದಲ್ಲಿ ಉತ್ತರಿಸಿ.",
        "te": "తెలుగులో సమాధానం ఇవ్వండి.",
        "ta": "தமிழில் பதிலளிக்கவும்."
    }.get(lang, "Reply in English.")

# ------------------------------
# Weather summary
# ------------------------------
@app.route('/summarize_weather', methods=['POST'])
def summarize_weather():
    d = request.json or {}

    prompt = f"""
{language_tag(d.get("language","en"))}
Summarize weather for farmers in 1–2 sentences (max 40 words).

Temp {d.get("temperature")}°C,
Humidity {d.get("humidity")}%,
Rain {d.get("rainfall",0)}mm,
Wind {d.get("windSpeed")},
Pressure {d.get("pressure")},
UV {d.get("uvIndex")}.
"""

    text = generate_ai_response(prompt)
    return jsonify({"text": text})

# ------------------------------
# Crop advisory
# ------------------------------
@app.route("/generate_advisory", methods=["POST"])
def generate_advisory():
    d = request.json or {}

    crop = d.get("crop_name", "crop")
    temp = d.get("temperature")
    humidity = d.get("humidity")
    rainfall = d.get("rainfall")

    if None in (temp, humidity, rainfall):
        return jsonify({"error": "Missing temperature, humidity or rainfall"}), 400

    prompt = f"""
{language_tag(d.get("language","en"))}
Give short farming advice for {crop}.
Limit to 60 words.

Temp {temp}°C,
Humidity {humidity}%,
Rainfall {rainfall}mm.
"""

    text = generate_ai_response(prompt)

    return jsonify({
        "advisory_text": text,
        "advisory_image_url": f"https://example.com/images/{crop.lower()}_advisory.png"
    })

# ------------------------------
# Crop care advice
# ------------------------------
@app.route("/crop_care_advice", methods=["POST"])
def crop_care_advice():
    d = request.json or {}

    if None in (d.get("crop_name"), d.get("temperature"),
                d.get("humidity"), d.get("rainfall")):
        return jsonify({"error": "Missing required fields"}), 400

    prompt = f"""
{language_tag(d.get("language","en"))}
Crop care advice (max 100 words).

Crop {d.get("crop_name")},
Stage {d.get("growth_stage","vegetative")},
Temp {d.get("temperature")}°C,
Humidity {d.get("humidity")}%,
Rain {d.get("rainfall")}mm,
MQ2 {d.get("mq2",0)}.
"""

    text = generate_ai_response(prompt)

    return jsonify({
        "success": True,
        "advice": {
            "crop": d.get("crop_name"),
            "growthStage": d.get("growth_stage","vegetative"),
            "aiRecommendations": text
        }
    })

# ------------------------------
# Chatbot
# ------------------------------
@app.route('/chatbot', methods=['POST'])
def chatbot():
    d = request.json or {}
    msg = d.get("message","").strip()

    if not msg:
        return jsonify({"error": "Message required"}), 400

    prompt = f"""
{language_tag(d.get("language","en"))}
Answer briefly (max 80 words).
Question: {msg}
"""

    reply = generate_ai_response(prompt)
    return jsonify({"success": True, "reply": reply})

# ------------------------------
# Start server
# ------------------------------
if __name__ == "__main__":
    port = int(os.getenv("PORT", 5003))
    app.run(host="0.0.0.0", port=port, debug=False)
