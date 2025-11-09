console.log('Starting test-main.js');
const electron = require('electron');
console.log('Electron type:', typeof electron);
console.log('Electron:', electron);

if (typeof electron === 'object' && electron.app) {
    const { app, BrowserWindow } = electron;
    console.log('App loaded successfully');

    app.whenReady().then(() => {
        console.log('App ready!');
        const win = new BrowserWindow({
            width: 800,
            height: 600
        });
        win.loadFile('../btron-desktop.html');
    });

    app.on('window-all-closed', () => {
        app.quit();
    });
} else {
    console.error('Electron did not load properly');
    console.error('Electron is:', electron);
}
