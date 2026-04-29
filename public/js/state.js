/**
 * js/state.js
 * Single global state object for the frontend SPA.
 * All views read from and write to this object.
 */

const state = {
  planType:              'Direct',
  optionType:            'Growth',
  currentView:           'home',
  currentCategory:       null,
  currentSubCategories:  [],
  selectedSubCategories: [],
  selectedMarketCaps:    [],
  sortBy:                'cagr3y',
  sortOrder:             'desc',
  page:                  1,
  limit:                 20,
  compareList:           [], // scheme codes selected for comparison
  searchQuery:           '',
  categorySummary:       {},
  loadingComplete:       false,
};
