import { defineConfig } from 'vite';
import { sensorBridge } from './server/sensors';

export default defineConfig({
  base: './',
  plugins: [sensorBridge()],
});
