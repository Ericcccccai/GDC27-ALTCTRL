import Phaser from 'phaser';
import GameScene from './GameScene';
import './style.css';
import { sensors } from './SensorStore';
const disconnectSensors = sensors.connect();
import { mountSensorPanel } from './SensorPanel';

export const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#f5eada',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1280,
    height: 800,
  },
  scene: [GameScene],
});

let sensorVisible = false;
const disposeSensors = mountSensorPanel(visible => {
  sensorVisible = visible;
  if (game.scene.isActive('GameScene') && visible) game.scene.pause('GameScene');
  else if (game.scene.isPaused('GameScene') && !visible) game.scene.resume('GameScene');
}, enabled => (game.scene.getScene('GameScene') as GameScene).setKeyboardTest(enabled));
game.events.on(Phaser.Core.Events.POST_STEP, () => {
  if (sensorVisible && game.scene.isActive('GameScene')) game.scene.pause('GameScene');
});
if (import.meta.hot) import.meta.hot.dispose(() => { disposeSensors(); disconnectSensors(); game.destroy(true); });
