import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { LocaleProvider } from './i18n.js';
import './styles.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><LocaleProvider><App /></LocaleProvider></React.StrictMode>);
