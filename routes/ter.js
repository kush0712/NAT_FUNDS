'use strict';
/**
 * routes/ter.js
 *
 * TER (Total Expense Ratio) lookup endpoint.
 *
 *   GET /ter/:schemeCode
 *     Returns AMFI-published TER for a scheme.
 *     Response: { nsdl_code, scheme_name, date, direct_ter, regular_ter }
 *     404 if the scheme is not found in the TER index.
 */

const express = require('express');
const router  = express.Router();

const state = require('../shared/appState');
const { getTERByName } = require('../services/terService');

router.get('/ter/:schemeCode', (req, res) => {
  const fund = state.fundsByCode[req.params.schemeCode];
  if (!fund) {
    return res.status(404).json({
      error: `Invalid scheme code: ${req.params.schemeCode}`,
    });
  }

  const record = getTERByName(fund.schemeName);
  if (!record) {
    return res.status(404).json({
      error: `TER data not found for scheme: ${fund.schemeName}`,
    });
  }

  res.json(record);
});

module.exports = router;
