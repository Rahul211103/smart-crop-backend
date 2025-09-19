from flask import Flask, request, jsonify
import joblib
import numpy as np

app = Flask(__name__)

# Load trained model and label encoder (must match model filenames!)
model = joblib.load('crop_rec_model.joblib')
encoder = joblib.load('label_encoder.joblib')

@app.route('/predict', methods=['POST'])
def predict():
    data = request.get_json()
    features = [
        data['temperature'],
        data['humidity'],
        data['rainfall']
    ]
    X = np.array(features).reshape(1, -1)
    pred = model.predict(X)
    crop_label = encoder.inverse_transform(pred)[0]
    # Convert to Python str to ensure JSON serialization
    return jsonify({'prediction': str(crop_label)})


if __name__ == '__main__':
    import os
    port = int(os.getenv('PORT', 5001))
    app.run(host='0.0.0.0', port=port)
