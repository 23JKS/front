from flask import Flask, jsonify, request
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///database.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

class HeatwaveEvent(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    date = db.Column(db.String(10), nullable=False)
    location = db.Column(db.String(100), nullable=False)

@app.route('/api/heatwave/events', methods=['GET'])
def get_heatwave_events():
    events = HeatwaveEvent.query.all()
    return jsonify([{'id': event.id, 'date': event.date, 'location': event.location} for event in events])

@app.route('/api/sst/daily', methods=['GET'])
def get_sst_daily():
    date = request.args.get('date')
    # 这里可以添加获取海温数据的逻辑
    return jsonify({'date': date, 'sst': 25.5})

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(debug=True)