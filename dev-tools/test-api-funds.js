const { server } = require('./server'); // Wait, server might not export itself
// Just import app and test it using a mock req, res
const app = require('./server'); 
