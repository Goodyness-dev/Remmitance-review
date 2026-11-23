import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './Desk.jsx';
import { Project } from './Project.jsx';

createRoot(document.getElementById('root')).render(location.pathname === '/desk' ? <App /> : <Project />);
