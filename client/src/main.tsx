import { render } from 'preact';
import { App } from './ui/App.js';
import './ui/styles.css';

const container = document.getElementById('app');
if (container) {
  render(<App />, container);
}
