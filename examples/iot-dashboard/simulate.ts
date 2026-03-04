// ─── Fake IoT Sensor Simulator ────────────────────────────────────
// Sends realistic sensor readings to Kalpa's HTTP endpoint every second.
// Run: npx tsx examples/iot-dashboard/simulate.ts

const API_URL = 'http://localhost:4000/sensors';

const SENSORS = [
    { id: 'temp-01', name: 'Temperature A', unit: '°C', base: 22, variance: 3 },
    { id: 'temp-02', name: 'Temperature B', unit: '°C', base: 26, variance: 4 },
    { id: 'humid-01', name: 'Humidity', unit: '%', base: 55, variance: 15 },
    { id: 'pressure-01', name: 'Pressure', unit: 'hPa', base: 1013, variance: 8 },
    { id: 'light-01', name: 'Light Level', unit: 'lux', base: 400, variance: 200 },
    { id: 'co2-01', name: 'CO₂', unit: 'ppm', base: 420, variance: 80 },
];

let tick = 0;

async function sendReading() {
    // Pick 2–3 random sensors each tick
    const count = 2 + Math.floor(Math.random() * 2);
    const chosen = [...SENSORS].sort(() => Math.random() - 0.5).slice(0, count);

    for (const sensor of chosen) {
        const value = sensor.base + (Math.random() - 0.5) * 2 * sensor.variance;
        const reading = {
            sensorId: sensor.id,
            name: sensor.name,
            value: Math.round(value * 10) / 10,
            unit: sensor.unit,
            timestamp: Date.now(),
            tick: tick++,
        };

        try {
            await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reading),
            });
            console.log(`  📡 ${sensor.name}: ${reading.value}${sensor.unit}`);
        } catch (err: any) {
            console.error(`  ❌ Failed to send: ${err.message}`);
        }
    }
}

console.log('\n  🏭 IoT Sensor Simulator');
console.log('  Sending readings to Kalpa every second...\n');

setInterval(sendReading, 1000);
sendReading(); // Send immediately
