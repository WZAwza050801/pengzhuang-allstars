import WebSocket from 'ws';

// Colyseus 0.16 passes Node-specific connection options; select its real ws transport in Node.
// Browser-native WebSocket remains exercised by test:e2e.
Object.defineProperty(globalThis, 'WebSocket', { value: WebSocket, configurable: true, writable: true });
