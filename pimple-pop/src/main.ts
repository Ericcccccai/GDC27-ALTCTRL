import Phaser from 'phaser';
import GameScene from './GameScene';
import './style.css';

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
