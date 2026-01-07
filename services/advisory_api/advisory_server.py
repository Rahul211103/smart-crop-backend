import os
import re
import traceback
from flask import Flask, request, jsonify, make_response
from flask_cors import CORS
from dotenv import load_dotenv
from openai import OpenAI

# ------------------------------
# Load environment variables
# ------------------------------
load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

if not OPENAI_API_KEY:
    raise RuntimeError("Missing OPENAI_API_KEY environment variable")

client = OpenAI(api_key=OPENAI_API_KEY)

# ------------------------------
# Flask App
# ------------------------------
app = Flask(__name__)
CORS(app)

# ------------------------------
# CORS preflight handler
# ------------------------------
@app.before_request
def before_request():
    if request.method == "OPTIONS":
        response = make_response()
        response.headers.add("Access-Control-Allow-Origin", "*")
        response.headers.add("Access-Control-Allow-Headers", "Content-Type,Authorization")
        response.headers.add("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        return response

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
# Language Instruction
# ------------------------------
def language_tag(lang: str) -> str:
    return {
        "en": "Respond in English.",
        "hi": "Respond in Hindi (हिन्दी).",
        "kn": "Respond in Kannada (ಕನ್ನಡ).",
        "te": "Respond in Telugu (తెలుగు).",
        "ta": "Respond in Tamil (தமிழ்)."
    }.get(lang, "Respond in English.")

# ------------------------------
# AI Response Generator (ChatGPT)
# ------------------------------
def generate_ai_response(prompt: str, lang: str = "en") -> str:
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": f"You are an expert farming advisor. {language_tag(lang)}"
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            temperature=0.4,
            max_tokens=300
        )

        text = response.choices[0].message.content.strip()
        return clean_markdown(text)

    except Exception as e:
        traceback.print_exc()
        return "AI service temporarily unavailable. Please try again later."

# ------------------------------
# Weather Summary
# ------------------------------
@app.route("/summarize_weather", methods=["POST"])
def summarize_weather():
    data = request.json or {}

    prompt = f"""
Write a concise 1–3 sentence weather summary for farmers.

Location:
City: {data.get("city")}
State: {data.get("state")}
Country: {data.get("country")}
Coordinates: ({data.get("lat")}, {data.get("lon")})

Conditions:
Temperature: {data.get("temperature")}°C
Humidity: {data.get("humidity")}%
Rainfall: {data.get("rainfall", 0)} mm
Wind Speed: {data.get("windSpeed")} m/s
Pressure: {data.get("pressure")} hPa
UV Index: {data.get("uvIndex")}

Plain text only.
"""

    text = generate_ai_response(prompt, data.get("language", "en"))
    return jsonify({"text": text})

# ------------------------------
# Crop Advisory
# ------------------------------
@app.route("/generate_advisory", methods=["POST"])
def generate_advisory():
    data = request.json or {}
    lang = data.get("language", "en")

    crop = data.get("crop_name", "crop")
    temp = data.get("temperature")
    humidity = data.get("humidity")
    rainfall = data.get("rainfall")
    pollution = data.get("pollution_level", 1)

    if any(v is None for v in (temp, humidity, rainfall)):
        return jsonify({"error": "Missing temperature, humidity, or rainfall"}), 400

    prompt = f"""
Generate a personalized farming advisory.

Crop: {crop}
Temperature: {temp}°C
Humidity: {humidity}%
Rainfall: {rainfall} mm
Pollution level: {pollution}

Plain text only. No bullets.
"""

    text = generate_ai_response(prompt, lang)

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
    lang = data.get("language", "en")

    if any(data.get(k) is None for k in ("crop_name", "temperature", "humidity", "rainfall")):
        return jsonify({"error": "Missing required fields"}), 400

    prompt = f"""
Provide detailed farming guidance.

Crop: {data.get("crop_name")}
Growth stage: {data.get("growth_stage", "vegetative")}

Conditions:
Temperature: {data.get("temperature")}°C
Humidity: {data.get("humidity")}%
Rainfall: {data.get("rainfall")} mm
MQ2: {data.get("mq2", 0)}

Explain:
Immediate actions (24–48h)
Weekly care
Pest and disease prevention
Nutrient management
Weather precautions
"""

    advice = generate_ai_response(prompt, lang)

    return jsonify({
        "success": True,
        "advice": {
            "crop": data.get("crop_name"),
            "growthStage": data.get("growth_stage", "vegetative"),
            "aiRecommendations": advice
        }
    })

# ------------------------------
# Chatbot
# ------------------------------
@app.route("/chatbot", methods=["POST"])
def chatbot():
    data = request.json or {}

    message = data.get("message")
    if not message:
        return jsonify({"success": False, "error": "Message required"}), 400

    reply = generate_ai_response(message, data.get("language", "en"))

    return jsonify({
        "success": True,
        "reply": reply,
        "language": data.get("language", "en")
    })

# ------------------------------
# Start Server
# ------------------------------
if __name__ == "__main__":
    port = int(os.getenv("PORT", 5003))
    app.run(host="0.0.0.0", port=port, debug=False)
