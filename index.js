require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const app = express();
const { compileWithOptions } = require('./utils/compile');
const verify = require('./utils/verify');
const chains = require('./utils/chains');

app.use(cors());
app.use(bodyParser.json({limit: '50mb'}));

app.post('/compile', async (req, res) => {
  const [
    collectionName,
    collectionSymbol,
    asciiArt
  ] = [
    req.body.name,
    req.body.symbol,
    req.body.asciiArt
  ];
  const compilationResult = compileWithOptions({
    collectionName,
    collectionSymbol,
    asciiArt
  });

  res.json(compilationResult);
});

app.post('/verify', async (req, res) => {
  try {
    const response = await verify(req.body);
    res.json(response);
  } catch (e) {
    console.log(e);
    res.status(500).json({ error: e.message });
  }
})

app.listen(8081, () => console.log('Listening 8081'));
