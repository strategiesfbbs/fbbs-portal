/**
 * FBBS Portal — Front-end JavaScript
 * Handles page navigation, file uploads, and data display.
 */

(function() {
  'use strict';

  let currentPackage = null;
  let archiveData = [];
  let qualitySummary = {
    warnings: 0,
    datesMatch: null,
    countsText: '—'
  };
  let marketData = {
    cds: [],
    munis: [],
    agencies: [],
    corporates: []
  };
  let dailyIntelData = null;
  let relativeValueData = null;
  let mmdData = null;
  let economicUpdateData = null;
  let selectedMarketSection = 'rates';
  let selectedCdCalcTerm = 3;
  let wirpStatusData = null;
  let cdOpportunityAnalysis = null;
  let cdOpportunitySearchTimer = null;
  let selectedCdRecapPeriod = 'previousWeek';
  let cdRecapData = null;
  let bankDataStatus = null;
  let selectedBank = null;
  let savedBanks = [];
  let accountCoverageAccounts = [];
  let accountCoverageRequestId = 0;
  let selectedBankAccountStatus = null;
  let selectedTearSheetCoverage = null;
  let selectedBankCoverage = null;
  let selectedBankNotes = [];
  let selectedBankContacts = [];
  let bankContactsEditingId = null;
  let bankContactsAdding = false;
  let selectedBankActivities = [];
  let bankActivityBankId = null;
  let bankActivityRequestId = 0;
  let bankLoadRequestId = 0;
  let tearSheetCoverageRequestId = 0;
  let selectedBankProductFit = [];
  let bankProductCatalog = [];
  let savedViewsState = {
    scope: 'me',
    summaries: [],
    selectedId: '',
    selectedResult: null,
    loading: false,
    loadingDetailFor: ''
  };
  let activeCoverageBankId = null;
  let activeBankWorkspaceView = 'tear-sheet';
  let bankAssistantLastResponse = null;
  const bankAssistantCache = new Map();
  const bankIntelligenceCache = new Map();
  let bankIntelligenceRequestId = 0;
  let bankIntelligenceLoading = false;
  let strategyRequests = [];
  let strategyCounts = {};
  let strategyNotifications = { requests: [], counts: {} };
  let meState = {
    rep: null,
    auth: { allowRepOverride: true, mode: 'local', isAdmin: false },
    knownReps: [],
    work: null,
    repsLoaded: false,
    workLoading: false,
    panelOpen: false,
    searchQuery: ''
  };
  let selectedBankStrategyHistory = [];
  let mbsCmoData = null;
  let structuredNotesData = null;
  let structuredNotesFilters = { search: '', structure: '' };
  let marketColorData = null;
  let cdInternalData = null;
  let bondAccountingManifest = null;
  let bondAccountingFilters = { search: '', status: '' };
  let bondAccountingFileSort = { key: 'filename', dir: 'asc' };
  let peerAnalysisState = { bankData: null, peerData: null, rows: [], flags: [], period: '', peerGroup: null };
  let reportsActiveRail = localStorage.getItem('fbbs.reports.lastRail') || 'recent';
  let reportsSearchQuery = '';
  let reportsSort = { key: 'lastRunAt', dir: 'desc' };
  let reportsSelectedType = '';
  let reportsSessionReports = [];
  let savedReportDefinitions = [];
  let hiddenReportIds = [];
  let reportsLoadPromise = null;
  let reportsAppEventsBound = false;
  let coverageBookState = { loaded: false, loading: false, banks: [], strategyCounts: {}, search: '', expanded: new Set(), detail: {} };
  let billingQueueState = { loaded: false, loading: false, requests: [], counts: {}, search: '', requestType: '', assignedTo: '' };
  let portfolioReviewState = { banks: [], selectedBankId: '', review: null, screen: 'topLosses', search: '', loading: false, searchRequestId: 0, bankPickerCollapsed: false, holdingSector: 'All', holdingSearch: '', holdingSort: { key: 'marketValue', dir: 'desc' } };
  let customBankReportState = {
    loading: false,
    dataset: null,
    fields: [],
    rows: [],
    lastRunAt: null,
    definitionId: '',
    name: '',
    filters: { search: '', states: '', statuses: '', minAssets: '', maxAssets: '', peerWatchOnly: false, savedOnly: false, portfolioOnly: false },
    selectedColumns: ['displayName', 'city', 'state', 'certNumber', 'accountStatusLabel', 'totalAssets', 'totalDeposits', 'securitiesToAssets', 'loansToDeposits', 'yieldOnSecurities', 'netInterestMargin'],
    sort: { key: 'totalAssets', dir: 'desc' }
  };
  let selectedFiles = {
    dashboard: null, econ: null, relativeValue: null, mmd: null, treasuryNotes: null, cd: null, cdoffers: null, cdoffersCost: null, munioffers: null, bairdSyndicate: null,
    agenciesBullets: null, agenciesCallables: null, corporates: null
  };

  const SLOTS = ['dashboard', 'econ', 'relativeValue', 'treasuryNotes', 'cd', 'cdoffers', 'munioffers', 'bairdSyndicate', 'agenciesBullets', 'agenciesCallables', 'corporates'];
  const TOTAL_SLOTS = SLOTS.length;
  const UPLOAD_SLOTS = ['dashboard', 'econ', 'relativeValue', 'mmd', 'treasuryNotes', 'cd', 'cdoffers', 'cdoffersCost', 'munioffers', 'bairdSyndicate', 'agenciesBullets', 'agenciesCallables', 'corporates'];

  const DOC_TYPES = {
    dashboard:         { label: 'FBBS Sales Dashboard', ext: 'HTML', viewer: 'dashboard' },
    econ:              { label: 'Economic Update', ext: 'PDF',  viewer: 'econ' },
    relativeValue:     { label: 'Relative Value', ext: 'PDF', viewer: 'relativeValue' },
    mmd:               { label: 'MMD Curve', ext: 'PDF', viewer: 'mmd' },
    treasuryNotes:     { label: 'Treasury Notes', ext: 'XLSX', viewer: 'treasuryNotes' },
    cd:                { label: 'Brokered CD Sheet', ext: 'PDF', viewer: 'cd' },
    cdoffers:          { label: 'Daily CD Offerings PDF', ext: 'PDF', viewer: 'cdoffers' },
    cdoffersCost:      { label: 'Internal CD Workbook', ext: 'XLSX', viewer: 'explorer' },
    munioffers:        { label: 'Muni Offerings', ext: 'PDF', viewer: 'munioffers' },
    bairdSyndicate:    { label: 'Baird Syndicate Munis', ext: 'XLSX', viewer: 'muni-explorer' },
    agenciesBullets:   { label: 'Agencies — Bullets', ext: 'XLSX', viewer: 'agencies' },
    agenciesCallables: { label: 'Agencies — Callables', ext: 'XLSX', viewer: 'agencies' },
    corporates:        { label: 'Corporates', ext: 'XLSX', viewer: 'corporates' }
  };

  const VALID_PAGES = ['home', 'daily-intelligence', 'dashboard', 'econ', 'relativeValue', 'mmd', 'treasuryNotes', 'cd', 'cdoffers', 'munioffers',
                       'treasury-explorer',
                       'cd-recap', 'cd-internal', 'explorer', 'muni-explorer', 'agencies', 'corporates',
                       'mbs-cmo', 'structured-notes', 'market-color', 'banks', 'maps', 'reports', 'peer-groups', 'strategies', 'bond-swap', 'views', 'archive', 'upload', 'package-qa', 'admin'];

  const NAV_ITEMS = [
    { page: 'home', group: 'Home', label: 'Home', description: 'Portal home page', aliases: 'home start main' },
    { page: 'daily-intelligence', group: 'FBBS', label: 'Daily Intelligence', description: 'Auto-generated market snapshot and rule-based picks', aliases: 'daily intelligence market snapshot top picks sales dashboard replacement' },
    { page: 'dashboard', group: 'FBBS', label: 'Sales Dashboard', description: 'Open the published FBBS dashboard', aliases: 'sales html full view fbbs' },
    { page: 'econ', group: 'FBBS', label: 'Economic Update', description: 'View or download the economic PDF', aliases: 'economy pdf download fbbs' },
    { page: 'relativeValue', group: 'FBBS', label: 'Relative Value', description: 'View or download the relative value PDF', aliases: 'relative value rv pdf daily sheet document' },
    { page: 'market-color', group: 'FBBS', label: 'Market Color', description: 'Reference market emails from the daily folder', aliases: 'morning iq market color email news s&p macro' },
    { page: 'mmd', group: 'FBBS', label: 'MMD Curve', description: 'View the Bloomberg FTAX MMD curve, Treasury ratios, and sales talking points', aliases: 'mmd curve ftax bloomberg muni municipal market data aaa ratios' },
    { page: 'cd', group: 'CDs', label: 'Brokered CD Sheet', description: 'View or download the brokered CD rate sheet', aliases: 'rate sheet brokered cd pdf' },
    { page: 'cdoffers', group: 'Documents', label: 'Daily CD Offerings PDF', description: 'View or download the raw Daily CD Offerings PDF', aliases: 'daily cd offerings offers pdf raw document' },
    { page: 'cd-recap', group: 'CDs', label: 'Weekly CD Recap', description: 'Deduped weekly CD issuance summary', aliases: 'weekly recap history median coupon cds' },
    { page: 'treasury-explorer', group: 'Offerings', label: 'Treasury Explorer', description: 'Filter, sort, and export Treasury Notes', aliases: 'treasury notes tsy cusip yield price spread offerings' },
    { page: 'explorer', group: 'Offerings', label: 'CD Explorer', description: 'Filter, sort, and export CD offerings', aliases: 'search cds cusip issuer rates offerings' },
    { page: 'munioffers', group: 'Documents', label: 'Muni Offerings PDF', description: 'View or download the raw muni offerings PDF', aliases: 'municipal pdf munis muni offerings raw document' },
    { page: 'muni-explorer', group: 'Offerings', label: 'Muni Explorer', description: 'Filter, sort, and export muni offerings', aliases: 'municipal bonds state rating munis offerings' },
    { page: 'agencies', group: 'Offerings', label: 'Agency Explorer', description: 'Search agency bullets and callables', aliases: 'agency agencies fhlb fnma callable bullet offerings' },
    { page: 'corporates', group: 'Offerings', label: 'Corporate Explorer', description: 'Search corporate inventory', aliases: 'corporate bonds issuer ticker sector offerings' },
    { page: 'mbs-cmo', group: 'Offerings', label: 'MBS/CMO Explorer', description: 'Upload, model, filter, and export mortgage-backed and CMO offerings', aliases: 'mbs cmo mortgage pools bloomberg bbg pac fmed offering screen snip' },
    { page: 'structured-notes', group: 'Offerings', label: 'Structured Notes', description: 'New issue and structured note inventory parsed from trader emails', aliases: 'structured notes new issue jpm gs bmo td callable zero steepener cusip' },
    { page: 'banks', group: 'Banks', label: 'Bank Tear Sheets', description: 'Search call report balance sheet and tear sheet data', aliases: 'bank call report balance sheet snl cert account coverage services' },
    { page: 'maps', group: 'Banks', label: 'US Bank Map', description: 'Choropleth and filterable bank list driven by call report data', aliases: 'map maps state choropleth heat geographic location filter' },
    { page: 'reports', group: 'Banks', label: 'Reports', description: 'Generate peer, portfolio, opportunity, coverage, and billing reports', aliases: 'reports peer analysis averaged series bond accounting portfolio coverage billing exports' },
    { page: 'peer-groups', group: 'Banks', label: 'Peer Groups', description: 'Curate peer cohorts by asset size, region, structure, and loan mix', aliases: 'peer group cohort comparison snl averaged series sub s ag focused custom' },
    { page: 'strategies', group: 'Strategies', label: 'Strategies Queue', description: 'Track bond swap, Muni BCIS, THO, CECL, and miscellaneous requests', aliases: 'bond swap bcis tho th o cecl monday tasks requests billing strategies' },
    { page: 'bond-swap', group: 'Strategies', label: 'Bond Swap', description: 'Portfolio Idea Engine and multi-leg swap-proposal builder', aliases: 'bond swap proposal portfolio idea engine swap builder cusip leg reinvest blotter' },
    { page: 'archive', group: 'Operations', label: 'Archive', description: 'Open previously published packages', aliases: 'history dates old documents' },
    { page: 'upload', group: 'Operations', label: 'Upload', description: 'Publish today\'s daily package', aliases: 'publish files drop documents agency cd muni corporate' },
    { page: 'package-qa', group: 'Operations', label: 'Package QA', description: 'Post-publish review of today\'s package — slot completeness and row counts', aliases: 'package qa quality review slots counts completeness validation check published treasury muni baird agency corporate' },
    { page: 'admin', group: 'Operations', label: 'Admin', description: 'Review the publish audit log', aliases: 'audit log admin history' }
  ];

  const NAV_GROUP_BY_PAGE = {
    'daily-intelligence': 'fbbs',
    dashboard: 'fbbs',
    econ: 'fbbs',
    relativeValue: 'fbbs',
    'market-color': 'fbbs',
    mmd: 'fbbs',
    cd: 'cds',
    'cd-recap': 'cds',
    'treasury-explorer': 'offerings',
    explorer: 'offerings',
    'muni-explorer': 'offerings',
    agencies: 'offerings',
    corporates: 'offerings',
    'mbs-cmo': 'offerings',
    'structured-notes': 'offerings',
    banks: 'banks',
    maps: 'banks',
    reports: 'banks'
  };

  const DEFAULT_BROKERED_CD_TERMS = [
    { label: '3 mo', months: 3, low: 3.900, mid: 3.950, high: 4.000 },
    { label: '6 mo', months: 6, low: 3.900, mid: 3.925, high: 3.950 },
    { label: '9 mo', months: 9, low: 3.950, mid: 4.000, high: 4.050 },
    { label: '12 mo', months: 12, low: 3.900, mid: 3.950, high: 4.000 },
    { label: '18 mo', months: 18, low: 3.950, mid: 4.025, high: 4.100 },
    { label: '2 yr', months: 24, low: 3.950, mid: 4.025, high: 4.100 },
    { label: '3 yr', months: 36, low: 3.950, mid: 4.025, high: 4.100 },
    { label: '4 yr', months: 48, low: 4.000, mid: 4.075, high: 4.150 },
    { label: '5 yr', months: 60, low: 4.050, mid: 4.125, high: 4.200 },
    { label: '7 yr', months: 84, low: 4.150, mid: 4.225, high: 4.300 },
    { label: '10 yr', months: 120, low: 4.250, mid: 4.325, high: 4.400 }
  ];

  const COMMISSION_STORAGE_KEY = 'fbbs_commission_settings_v1';
  const BANK_RECENT_STORAGE_KEY = 'fbbs_recent_banks_v1';
  const MAX_RECENT_BANKS = 5;
  const BANK_COVERAGE_STATUSES = ['Open', 'Prospect', 'Client', 'Watchlist', 'Dormant'];
  const BANK_COVERAGE_PRIORITIES = ['High', 'Medium', 'Low'];
  const FBBS_SERVICE_NAMES = ['ALM', 'BCIS', 'Brokered CDs', 'CECL', 'Bond Accounting'];
  const BANKERS_BANK_SERVICE_NAMES = [
    'ACH Origination',
    'Audit',
    'Bank Stock Loan',
    'Cash Management',
    'Online Banking',
    'DDA',
    'FedNow',
    'Fed Settlement',
    'International Services',
    'Image Cash Letter',
    'Participation Loans Sold',
    'RTP',
    'Safekeeping',
    'Stockholder',
    'Wire Transfer'
  ];
  const PEER_ANALYSIS_METRICS = [
    { key: 'totalAssets', label: 'Total Assets', type: 'money', section: 'Balance Sheet', higherIsBetter: null, peerLabels: [/^total assets/i] },
    { key: 'afsTotal', label: 'Total Securities AFS-FV', type: 'money', section: 'Balance Sheet', higherIsBetter: null, peerLabels: [/^total securities\s*\(afs-fv\)/i] },
    { key: 'htmTotal', label: 'Total Securities HTM-FV', type: 'money', section: 'Balance Sheet', higherIsBetter: null, peerLabels: [/^total securities\s*\(htm-fv\)/i] },
    { key: 'securitiesToAssets', label: 'Securities / Assets', type: 'percent', section: 'Balance Sheet', higherIsBetter: null, peerLabels: [/^total securities\s*\/\s*total assets/i, /securities.*assets/i] },
    { key: 'totalLoans', label: 'Total Loans & Leases', type: 'money', section: 'Balance Sheet', higherIsBetter: null, peerLabels: [/^total loans.*leases/i] },
    { key: 'loansToAssets', label: 'Loans / Assets', type: 'percent', section: 'Balance Sheet', higherIsBetter: null, peerLabels: [/^total loans\s*\/\s*assets/i] },
    { key: 'totalDeposits', label: 'Total Deposits', type: 'money', section: 'Balance Sheet', higherIsBetter: null, peerLabels: [/^total deposits/i] },
    { key: 'loansToDeposits', label: 'Loans / Deposits', type: 'percent', section: 'Balance Sheet', higherIsBetter: null, peerLabels: [/loans?\s*\/\s*deposits?/i, /loans?.*deposits?/i] },
    { key: 'totalBorrowings', label: 'Total Borrowings', type: 'money', section: 'Balance Sheet', higherIsBetter: null, peerLabels: [/^total borrowings/i] },
    { key: 'realEstateLoansToLoans', label: 'Real Estate Loans / Loans', type: 'percent', section: 'Loan Mix', higherIsBetter: null, peerLabels: [/^real estate loans\s*\/\s*loans/i] },
    { key: 'farmLoansToLoans', label: 'Farmland / Loans', type: 'percent', section: 'Loan Mix', higherIsBetter: null, peerLabels: [/^farmland.*\/\s*loans/i] },
    { key: 'agProdLoansToLoans', label: 'Agricultural Production / Loans', type: 'percent', section: 'Loan Mix', higherIsBetter: null, peerLabels: [/^agricultural prod.*\/\s*loans/i] },
    { key: 'ciLoansToLoans', label: 'C&I Loans / Loans', type: 'percent', section: 'Loan Mix', higherIsBetter: null, peerLabels: [/^total c\s*&\s*i loans\s*\/\s*loans/i, /^total c and i loans\s*\/\s*loans/i] },
    { key: 'totalEquityCapital', label: 'Total Equity Capital', type: 'money', section: 'Capital', higherIsBetter: null, peerLabels: [/^total equity capital/i] },
    { key: 'tier1Capital', label: 'Tier 1 Capital', type: 'money', section: 'Capital', higherIsBetter: null, peerLabels: [/^tier 1 capital/i] },
    { key: 'tier1RiskBasedRatio', label: 'Tier 1 Risk-Based Ratio', type: 'percent', section: 'Capital', higherIsBetter: true, peerLabels: [/^tier 1.*risk/i] },
    { key: 'riskBasedCapitalRatio', label: 'Risk-Based Capital Ratio', type: 'percent', section: 'Capital', higherIsBetter: true, peerLabels: [/^risk based capital ratio/i] },
    { key: 'tangibleEquityToAssets', label: 'Tangible Equity / Assets', type: 'percent', section: 'Capital', higherIsBetter: true, peerLabels: [/^tang equity\s*\/\s*tang assets/i] },
    { key: 'leverageRatio', label: 'Leverage Ratio', type: 'percent', section: 'Capital', higherIsBetter: true, peerLabels: [/^leverage ratio/i] },
    { key: 'dividendsDeclared', label: 'Dividends Declared', type: 'money', section: 'Capital', higherIsBetter: null, peerLabels: [/^total dividends declared/i] },
    { key: 'dividendsToNetIncome', label: 'Dividends / Net Income', type: 'percent', section: 'Capital', higherIsBetter: null, peerLabels: [/^common divis declared\s*\/\s*net inc/i] },
    { key: 'roa', label: 'ROA', type: 'percent', section: 'Profitability', higherIsBetter: true, peerLabels: [/^roa\b/i, /return on assets/i, /return on avg/i] },
    { key: 'roe', label: 'ROE', type: 'percent', section: 'Profitability', higherIsBetter: true, peerLabels: [/^roe\b/i, /return on equity/i] },
    { key: 'yieldOnEarningAssets', label: 'Yield on Earning Assets', type: 'percent', section: 'Profitability', higherIsBetter: true, peerLabels: [/^yield on earning assets/i] },
    { key: 'yieldOnLoans', label: 'Yield on Loans', type: 'percent', section: 'Profitability', higherIsBetter: true, peerLabels: [/^yield on loans/i] },
    { key: 'yieldOnSecurities', label: 'Yield on Securities', type: 'percent', section: 'Profitability', higherIsBetter: true, peerLabels: [/yield on securities/i] },
    { key: 'netInterestMargin', label: 'Net Interest Margin', type: 'percent', section: 'Profitability', higherIsBetter: true, peerLabels: [/net interest margin/i] },
    { key: 'efficiencyRatio', label: 'Efficiency Ratio', type: 'percent', section: 'Profitability', higherIsBetter: false, peerLabels: [/efficiency ratio/i] },
    { key: 'costOfFunds', label: 'Cost of Funds', type: 'percent', section: 'Profitability', higherIsBetter: false, peerLabels: [/^cost of funds/i] },
    { key: 'netIncome', label: 'Net Income', type: 'money', section: 'Profitability', higherIsBetter: null, peerLabels: [/^net income/i] },
    { key: 'depositsPerFte', label: 'Deposits / FTE', type: 'money', section: 'Profitability', higherIsBetter: null, peerLabels: [/^deposits\s*\/\s*fte/i] },
    { key: 'realizedGainLossSecurities', label: 'Realized Gain/Loss on Securities', type: 'money', section: 'Profitability', higherIsBetter: null, peerLabels: [/^realized gain\/loss on securities/i] },
    { key: 'texasRatio', label: 'Texas Ratio', type: 'percent', section: 'Credit', higherIsBetter: false, peerLabels: [/texas ratio/i] },
    { key: 'llrToLoans', label: 'Loan Loss Reserves / Loans', type: 'percent', section: 'Credit', higherIsBetter: true, peerLabels: [/^loan loss reserves\s*\/\s*loans/i] },
    { key: 'nplsToLoans', label: 'NPLs / Loans', type: 'percent', section: 'Credit', higherIsBetter: false, peerLabels: [/npls?.*loans/i, /nonperforming.*loans/i] },
    { key: 'loanLossReserve', label: 'Loan & Lease Loss Reserve', type: 'money', section: 'Credit', higherIsBetter: null, peerLabels: [/^loan\s*&\s*lease loss reserve/i] },
    { key: 'loanLossProvision', label: 'Loan Loss Provision', type: 'money', section: 'Credit', higherIsBetter: false, peerLabels: [/^provision for loan\s*&\s*lease losses/i] },
    { key: 'netChargeoffsToAvgLoans', label: 'Net Chargeoffs / Avg Loans', type: 'percent', section: 'Credit', higherIsBetter: false, peerLabels: [/^net chargeoffs\s*\/\s*avg loans/i] },
    { key: 'largeDepositsToDeposits', label: 'Deposits > $250K / Deposits', type: 'percent', denominatorKey: 'totalDeposits', section: 'Liquidity', higherIsBetter: false, peerLabels: [/^total dep with bal > \$?250k\s*\/\s*deposits/i] },
    { key: 'nonInterestBearingDeposits', label: 'Non-Interest Bearing Deposits / Deposits', type: 'percent', section: 'Liquidity', higherIsBetter: true, peerLabels: [/^non-int bearing dep\s*\/\s*deposits/i] },
    { key: 'brokeredDepositsToDeposits', label: 'Brokered Deposits / Deposits', type: 'percent', section: 'Liquidity', higherIsBetter: false, peerLabels: [/^brokered deposits\s*\/\s*deposits/i] },
    { key: 'jumboTimeDeposits', label: 'Jumbo Time Deposits / Deposits', type: 'percent', section: 'Liquidity', higherIsBetter: false, peerLabels: [/^jumbo time dep\s*\/\s*dom deposits/i] },
    { key: 'publicFunds', label: 'Public Funds / Deposits', type: 'percent', section: 'Liquidity', higherIsBetter: null, peerLabels: [/^public funds\s*\/\s*dom deposits/i] },
    { key: 'netNonCoreFundingDependence', label: 'Net NonCore Funding Dependence', type: 'percent', section: 'Liquidity', higherIsBetter: false, peerLabels: [/^net noncore funding dependence/i] },
    { key: 'wholesaleFundingReliance', label: 'Reliance on Wholesale Funding', type: 'percent', section: 'Liquidity', higherIsBetter: false, peerLabels: [/wholesale funding/i] },
    { key: 'longTermAssetsToAssets', label: 'Long-Term Assets / Assets', type: 'percent', section: 'Liquidity', higherIsBetter: false, peerLabels: [/long.?term assets?.*assets/i] },
    { key: 'liquidAssetsToAssets', label: 'Liquid Assets / Assets', type: 'percent', section: 'Liquidity', higherIsBetter: true, peerLabels: [/liquid assets?.*assets/i] },
    { key: 'avgIntBearingFundsToAssets', label: 'Avg Interest-Bearing Funds / Avg Assets', type: 'percent', section: 'Liquidity', higherIsBetter: false, peerLabels: [/^avg int bear funds\s*\/\s*avg assets/i] },
    { key: 'intEarnAssetsToFunds', label: 'Interest-Earning Assets / Interest-Bearing Funds', type: 'percent', section: 'Liquidity', higherIsBetter: true, peerLabels: [/^int earn assets\s*\/\s*int bear funds/i] },
    { key: 'pledgedSecuritiesToSecurities', label: 'Pledged Securities / Securities', type: 'percent', section: 'Liquidity', higherIsBetter: false, peerLabels: [/^pledged securities\s*\(bv\)/i, /^pledged securites\s*\/\s*securities/i, /^pledged securities\s*\/\s*securities/i] },
    { key: 'securitiesFvToBv', label: 'Securities FV / BV', type: 'percent', section: 'Liquidity', higherIsBetter: true, peerLabels: [/^securities\s*\(fv\)\s*\/\s*securities\s*\(bv\)/i] }
  ];
  const STRATEGY_TYPES = ['Bond Swap', 'Muni BCIS', 'THO Report', 'CECL Analysis', 'Miscellaneous'];
  const STRATEGY_STATUSES = ['Open', 'In Progress', 'Needs Billed', 'Completed'];
  const STRATEGY_PRIORITIES = ['1', '2', '3', '4', '5'];
  const REPORT_TYPE_META = {
    'custom-bank': {
      slug: 'custom-bank',
      name: 'Custom Bank List',
      shortName: 'Bank List',
      category: 'Bank Intelligence',
      folder: 'Coverage',
      description: 'Build a reusable bank list from call-report fields, account status, peer gaps, and report availability.'
    },
    'bank-peer': {
      slug: 'bank-peer',
      name: 'Bank Peer Analysis',
      shortName: 'Bank Peer',
      category: 'Bank Intelligence',
      folder: 'Coverage',
      description: 'Compare a selected bank against peer averages for liquidity, securities, profitability, capital, and asset quality.'
    },
    'portfolio-peer': {
      slug: 'portfolio-peer',
      name: 'Portfolio Review Workbench',
      shortName: 'Portfolio Review',
      category: 'Portfolio',
      folder: 'Portfolio Reviews',
      description: 'Turn matched bond-accounting files into portfolio metrics, screens, flags, and current-inventory swap ideas.'
    },
    opportunity: {
      slug: 'opportunity',
      name: 'Opportunity Report',
      shortName: 'Opportunity',
      category: 'Sales',
      folder: 'Sales Strategy',
      description: 'Surface banks with peer gaps that suggest funding, liquidity, bond swap, muni, or CECL conversations.'
    },
    coverage: {
      slug: 'coverage',
      name: 'Coverage Book',
      shortName: 'Coverage',
      category: 'Sales',
      folder: 'Coverage',
      description: 'Summarize saved banks, statuses, notes, strategy requests, latest call-report period, and report availability.'
    },
    'billing-queue': {
      slug: 'billing-queue',
      name: 'Billing Queue',
      shortName: 'Billing',
      category: 'Billing & Ops',
      folder: 'Billing & Ops',
      description: 'Review strategy requests waiting to be billed, grouped by request type, owner, invoice contact, and age.'
    }
  };
  const REPORT_FIXTURES = [
    { id: 'fixture-custom-bank', name: 'Custom Bank List - Coverage Pipeline', type: 'custom-bank', folder: 'Coverage', description: REPORT_TYPE_META['custom-bank'].description, lastRunAt: '2026-05-14T09:10:00.000Z', lastRunBy: 'You', pinned: true },
    { id: 'fixture-bank-peer', name: 'Bank Peer Analysis - Coverage Baseline', type: 'bank-peer', folder: 'Coverage', description: REPORT_TYPE_META['bank-peer'].description, lastRunAt: '2026-05-13T08:15:00.000Z', lastRunBy: 'You', pinned: true },
    { id: 'fixture-opportunity', name: 'Midwest Opportunity Scan', type: 'opportunity', folder: 'Sales Strategy', description: REPORT_TYPE_META.opportunity.description, lastRunAt: '2026-05-12T15:40:00.000Z', lastRunBy: 'You', pinned: false },
    { id: 'fixture-portfolio', name: 'Portfolio Review Workbench - Matched Files', type: 'portfolio-peer', folder: 'Portfolio Reviews', description: REPORT_TYPE_META['portfolio-peer'].description, lastRunAt: '2026-05-12T10:05:00.000Z', lastRunBy: 'You', pinned: false },
    { id: 'fixture-coverage', name: 'Coverage Book - Saved Banks', type: 'coverage', folder: 'Coverage', description: REPORT_TYPE_META.coverage.description, lastRunAt: '2026-05-11T16:25:00.000Z', lastRunBy: 'You', pinned: false },
    { id: 'fixture-billing', name: 'Billing Queue - Strategy Requests', type: 'billing-queue', folder: 'Billing & Ops', description: REPORT_TYPE_META['billing-queue'].description, lastRunAt: '2026-05-11T14:35:00.000Z', lastRunBy: 'You', pinned: false }
  ];
  const SAVED_REPORTS_STORAGE_KEY = 'fbbs.reports.savedDefinitions';
  const HIDDEN_REPORTS_STORAGE_KEY = 'fbbs.reports.hiddenRows';
  const CUSTOM_BANK_REPORT_COLUMNS = [
    { key: 'displayName', label: 'Bank', type: 'text', section: 'Details' },
    { key: 'city', label: 'City', type: 'text', section: 'Details' },
    { key: 'state', label: 'State', type: 'text', section: 'Details' },
    { key: 'county', label: 'County', type: 'text', section: 'Details' },
    { key: 'certNumber', label: 'Cert', type: 'text', section: 'Details' },
    { key: 'accountStatusLabel', label: 'Status', type: 'text', section: 'Coverage' },
    { key: 'coverageOwner', label: 'Owner', type: 'text', section: 'Coverage' },
    { key: 'portfolioAvailable', label: 'Portfolio File', type: 'boolean', section: 'Reports' },
    { key: 'totalAssets', label: 'Assets', type: 'money', section: 'Balance Sheet' },
    { key: 'totalDeposits', label: 'Deposits', type: 'money', section: 'Balance Sheet' },
    { key: 'totalEquityCapital', label: 'Equity Capital', type: 'money', section: 'Balance Sheet' },
    { key: 'afsTotal', label: 'AFS Securities', type: 'money', section: 'Securities' },
    { key: 'htmTotal', label: 'HTM Securities', type: 'money', section: 'Securities' },
    { key: 'securitiesToAssets', label: 'Securities / Assets', type: 'percent', section: 'Securities' },
    { key: 'loansToAssets', label: 'Loans / Assets', type: 'percent', section: 'Loans' },
    { key: 'loansToDeposits', label: 'Loans / Deposits', type: 'percent', section: 'Liquidity' },
    { key: 'yieldOnSecurities', label: 'Yield on Securities', type: 'percent', section: 'Profitability' },
    { key: 'netInterestMargin', label: 'NIM', type: 'percent', section: 'Profitability' },
    { key: 'costOfFunds', label: 'Cost of Funds', type: 'percent', section: 'Profitability' },
    { key: 'tier1RiskBasedRatio', label: 'Tier 1 RBC', type: 'percent', section: 'Capital' },
    { key: 'texasRatio', label: 'Texas Ratio', type: 'percent', section: 'Credit' },
    { key: 'peerDelta_securitiesToAssets', label: 'Securities Gap', type: 'percent', section: 'Peer Gaps' },
    { key: 'peerDelta_yieldOnSecurities', label: 'Securities Yield Gap', type: 'percent', section: 'Peer Gaps' },
    { key: 'peerDelta_netInterestMargin', label: 'NIM Gap', type: 'percent', section: 'Peer Gaps' },
    { key: 'peerDelta_liquidAssetsToAssets', label: 'Liquid Assets Gap', type: 'percent', section: 'Peer Gaps' },
    { key: 'peerDelta_longTermAssetsToAssets', label: 'Long-Term Assets Gap', type: 'percent', section: 'Peer Gaps' }
  ];
  const REPORT_RAIL_ITEMS = [
    { id: 'recent', section: 'REPORTS', label: 'Recent' },
    { id: 'created', section: 'REPORTS', label: 'Created by Me' },
    { id: 'saved-views', section: 'REPORTS', label: 'Saved Views' },
    { id: 'pinned', section: 'REPORTS', label: 'Pinned' },
    { id: 'all', section: 'REPORTS', label: 'All Reports' },
    { id: 'folders-all', section: 'FOLDERS', label: 'All Folders' },
    { id: 'folder-coverage', section: 'FOLDERS', label: 'Coverage', folder: 'Coverage' },
    { id: 'folder-sales', section: 'FOLDERS', label: 'Sales Strategy', folder: 'Sales Strategy' },
    { id: 'folder-portfolio', section: 'FOLDERS', label: 'Portfolio Reviews', folder: 'Portfolio Reviews' },
    { id: 'folder-billing', section: 'FOLDERS', label: 'Billing', folder: 'Billing' },
    { id: 'folder-personal', section: 'FOLDERS', label: 'Personal', folder: 'Personal' }
  ];
  const COMMISSION_PRODUCT_LABELS = {
    agencies: 'Agencies',
    corporates: 'Corporates'
  };
  const DEFAULT_COMMISSION_SETTINGS = {
    agencies: { enabled: false, method: 'dollars', dollarMarkup: 5, bpMarkup: 50 },
    corporates: { enabled: false, method: 'dollars', dollarMarkup: 5, bpMarkup: 50 }
  };
  const MUNI_TAX_AUDIENCES = {
    ccorp: {
      label: 'Bank C-Corp',
      rate: 21,
      capitalGainsRate: 21,
      costOfFunds: 2,
      bqDisallowance: 20,
      generalDisallowance: 100,
      applyTefra: true
    },
    scorp: {
      label: 'S-Corp',
      rate: 29.6,
      capitalGainsRate: 29.6,
      costOfFunds: 2,
      bqDisallowance: 0,
      generalDisallowance: 100,
      applyTefra: true
    },
    individual: {
      label: 'Individual',
      rate: 35,
      capitalGainsRate: 15,
      costOfFunds: 0,
      bqDisallowance: 0,
      generalDisallowance: 0,
      applyTefra: false
    }
  };
  let muniTaxSettings = { audience: 'ccorp', ...MUNI_TAX_AUDIENCES.ccorp };
  let commissionSettings = loadCommissionSettings();

  // ============ Utilities ============

  function showToast(msg, isError) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => t.classList.remove('show'), 3500);
  }

  function setPeerAnalysisValidation(message) {
    const validation = document.getElementById('peerAnalysisValidation');
    if (!validation) return;
    validation.textContent = message || '';
    validation.hidden = !message;
  }

  function loadCommissionSettings() {
    try {
      const raw = localStorage.getItem(COMMISSION_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const settings = {};
      Object.keys(DEFAULT_COMMISSION_SETTINGS).forEach(product => {
        settings[product] = {
          ...DEFAULT_COMMISSION_SETTINGS[product],
          ...(parsed[product] || {})
        };
        if (settings[product].dollarMarkup == null && settings[product].manualBp != null) {
          settings[product].dollarMarkup = Number(settings[product].manualBp) / 10;
        }
        if (settings[product].bpMarkup == null && settings[product].manualBp != null) {
          settings[product].bpMarkup = Number(settings[product].manualBp);
        }
        if (settings[product].method !== 'bps') settings[product].method = 'dollars';
        settings[product].dollarMarkup = normalizeCommissionDollars(settings[product].dollarMarkup);
        settings[product].bpMarkup = normalizeCommissionBps(settings[product].bpMarkup);
      });
      return settings;
    } catch (e) {
      return JSON.parse(JSON.stringify(DEFAULT_COMMISSION_SETTINGS));
    }
  }

  function saveCommissionSettings() {
    try {
      localStorage.setItem(COMMISSION_STORAGE_KEY, JSON.stringify(commissionSettings));
    } catch (e) {
      // Storage is a convenience only; the overlay still works for the session.
    }
  }

  function normalizeCommissionDollars(value) {
    const n = Number(value);
    if (!isFinite(n) || n < 0) return 0;
    return Math.min(100, n);
  }

  function normalizeCommissionBps(value) {
    const n = Number(value);
    if (!isFinite(n) || n < 0) return 0;
    return Math.min(1000, n);
  }

  function commissionMarkForProduct(product) {
    const settings = commissionSettings[product];
    if (!settings || !settings.enabled) return null;
    if (settings.method === 'bps') {
      const bps = normalizeCommissionBps(settings.bpMarkup);
      return {
        label: `${Number(bps).toFixed(Number(bps) % 1 === 0 ? 0 : 2)} bp`,
        method: 'bps',
        value: bps
      };
    }
    const dollars = normalizeCommissionDollars(settings.dollarMarkup);
    return {
      label: formatCommissionDollars(dollars),
      method: 'dollars',
      value: dollars
    };
  }

  function formatCommissionDollars(dollars) {
    if (dollars == null) return '';
    return `$${Number(dollars).toFixed(Number(dollars) % 1 === 0 ? 0 : 2)}`;
  }

  function commissionSubline(text) {
    return text ? `<span class="commission-subline">${escapeHtml(text)}</span>` : '';
  }

  function markedAgencyValues(record) {
    const commission = commissionMarkForProduct('agencies');
    if (!commission || !record || record.askPrice == null) return null;
    const baseBasis = agencySpreadBasis(record);
    const clientPrice = markedAgencyPrice(record, commission, baseBasis);
    if (clientPrice == null) return null;
    const priceMarkup = clientPrice - record.askPrice;
    const ytmDelta = yieldDeltaForPriceMark(record, record.maturity, record.ytm, clientPrice);
    const ytncDelta = yieldDeltaForPriceMark(record, record.nextCallDate, record.ytnc, clientPrice);
    const markedYtm = ytmDelta == null || record.ytm == null ? null : record.ytm + ytmDelta;
    const markedYtnc = ytncDelta == null || record.ytnc == null ? null : record.ytnc + ytncDelta;
    const markedSpreadBasis = agencySpreadBasis(record, clientPrice, { ytm: markedYtm, ytnc: markedYtnc });
    const markedSpread = markedAgencySpread(record, markedSpreadBasis);
    return { ...commission, priceMarkup, clientPrice, markedYtm, markedYtnc, markedSpreadBasis, markedSpread };
  }

  function markedAgencyPrice(record, commission, baseBasis) {
    if (!commission || !record) return null;
    if (commission.method === 'bps') {
      if (!baseBasis || baseBasis.yieldPct == null) return null;
      const markedYieldPct = baseBasis.yieldPct - (commission.value / 100);
      const modelBasePrice = solveBondPrice(record.coupon, baseBasis.yieldPct, baseBasis.date, record.settle);
      const modelMarkedPrice = solveBondPrice(record.coupon, markedYieldPct, baseBasis.date, record.settle);
      if (modelBasePrice == null || modelMarkedPrice == null) return null;
      return record.askPrice + (modelMarkedPrice - modelBasePrice);
    }
    return record.askPrice + (commission.value / 10);
  }

  function markedAgencySpread(record, markedBasis) {
    const baseBasis = agencySpreadBasis(record);
    if (!markedBasis || markedBasis.yieldPct == null) return null;
    const treasury = treasuryForAgencyBasis(markedBasis);
    if (treasury && treasury.yield != null) return (markedBasis.yieldPct - treasury.yield) * 100;

    const baseSpread = effectiveAgencySpread(record);
    if (baseSpread == null || !baseBasis || baseBasis.key !== markedBasis.key) return null;
    return baseSpread + ((markedBasis.yieldPct - baseBasis.yieldPct) * 100);
  }

  function yieldDeltaForPriceMark(record, endDate, sourceYieldPct, markedPrice) {
    if (!record || record.askPrice == null || record.coupon == null || !endDate || sourceYieldPct == null) return null;
    const baseModelYield = solveBondYieldPct(record.coupon, record.askPrice, endDate, record.settle);
    const markedModelYield = solveBondYieldPct(record.coupon, markedPrice, endDate, record.settle);
    if (baseModelYield == null || markedModelYield == null) return null;
    return markedModelYield - baseModelYield;
  }

  function solveBondYieldPct(couponPct, price, endDateStr, settleDateStr) {
    const priceNum = Number(price);
    const coupon = Number(couponPct);
    if (!isFinite(priceNum) || priceNum <= 0 || !isFinite(coupon)) return null;

    const settle = parseIsoDate(settleDateStr) || new Date();
    const endDate = parseIsoDate(endDateStr);
    if (!endDate || endDate <= settle) return null;

    const periods = Math.max(1, Math.ceil(monthsBetween(settle, endDate) / 6));
    const couponPerPeriod = coupon / 2;

    let low = -0.95;
    let high = 1.5;
    for (let i = 0; i < 80; i++) {
      const mid = (low + high) / 2;
      const pv = bondPriceFromYield(mid, couponPerPeriod, periods);
      if (pv > priceNum) low = mid;
      else high = mid;
    }
    return ((low + high) / 2) * 100;
  }

  function solveBondPrice(couponPct, yieldPct, endDateStr, settleDateStr) {
    const coupon = Number(couponPct);
    const yieldNum = Number(yieldPct);
    if (!isFinite(coupon) || !isFinite(yieldNum)) return null;
    const settle = parseIsoDate(settleDateStr) || new Date();
    const endDate = parseIsoDate(endDateStr);
    if (!endDate || endDate <= settle) return null;
    const periods = Math.max(1, Math.ceil(monthsBetween(settle, endDate) / 6));
    return bondPriceFromYield(yieldNum / 100, coupon / 2, periods);
  }

  function bondPriceFromYield(yieldDecimal, couponPerPeriod, periods) {
    const rate = yieldDecimal / 2;
    let pv = 0;
    for (let i = 1; i <= periods; i++) {
      pv += couponPerPeriod / Math.pow(1 + rate, i);
    }
    pv += 100 / Math.pow(1 + rate, periods);
    return pv;
  }

  function parseIsoDate(dateStr) {
    if (!dateStr) return null;
    const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
    return isNaN(d) ? null : d;
  }

  function monthsBetween(start, end) {
    return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + ((end.getDate() - start.getDate()) / 30.4375);
  }

  function commissionPriceHtml(product, record, price, decimals) {
    if (price == null) return '<span class="no-restrict">&mdash;</span>';
    const base = Number(price).toFixed(decimals == null ? 3 : decimals);
    const marked = product === 'corporates' ? markedCorporateValues(record) : markedAgencyValues(record);
    if (!marked) return base;
    return `${base}${commissionSubline(`client ${marked.clientPrice.toFixed(decimals == null ? 3 : decimals)} / ${marked.label}`)}`;
  }

  function commissionSpreadHtml(record) {
    const spread = effectiveAgencySpread(record);
    if (!record || spread == null) return '<span class="no-restrict">&mdash;</span>';
    const base = Number(spread).toFixed(1);
    const marked = markedAgencyValues(record);
    if (!marked || marked.markedSpread == null) return base;
    return `${base}${commissionSubline(`marked ${marked.markedSpread.toFixed(1)}`)}`;
  }

  function commissionYieldHtml(record, key, decimals) {
    const baseYield = record && record[key];
    if (baseYield == null) return '<span class="no-restrict">&mdash;</span>';
    const base = Number(baseYield).toFixed(decimals == null ? 3 : decimals);
    const marked = markedAgencyValues(record);
    const markedYield = key === 'ytnc' ? marked && marked.markedYtnc : marked && marked.markedYtm;
    if (markedYield == null) return base;
    return `${base}${commissionSubline(`marked ${markedYield.toFixed(decimals == null ? 3 : decimals)}`)}`;
  }

  function markedCorporateValues(record) {
    const commission = commissionMarkForProduct('corporates');
    if (!commission || !record || record.askPrice == null) return null;
    const baseBasis = corporateYieldBasis(record);
    const clientPrice = markedCorporatePrice(record, commission, baseBasis);
    if (clientPrice == null) return null;
    const priceMarkup = clientPrice - record.askPrice;
    const ytmDelta = yieldDeltaForPriceMark(record, record.maturity, record.ytm, clientPrice);
    const ytncDelta = yieldDeltaForPriceMark(record, record.nextCallDate, record.ytnc, clientPrice);
    const markedYtm = ytmDelta == null || record.ytm == null ? null : record.ytm + ytmDelta;
    const markedYtnc = ytncDelta == null || record.ytnc == null ? null : record.ytnc + ytncDelta;
    const markedSpread = record.askSpread == null || ytmDelta == null ? null : record.askSpread + (ytmDelta * 100);
    return { ...commission, priceMarkup, clientPrice, markedYtm, markedYtnc, markedSpread };
  }

  function corporateYieldBasis(record) {
    if (!record) return null;
    if (record.maturity && record.ytm != null) return { date: record.maturity, yieldPct: record.ytm, key: 'ytm' };
    if (record.nextCallDate && record.ytnc != null) return { date: record.nextCallDate, yieldPct: record.ytnc, key: 'ytnc' };
    return null;
  }

  function markedCorporatePrice(record, commission, baseBasis) {
    if (!commission || !record) return null;
    if (commission.method === 'bps') {
      if (!baseBasis || baseBasis.yieldPct == null) return null;
      const markedYieldPct = baseBasis.yieldPct - (commission.value / 100);
      const modelBasePrice = solveBondPrice(record.coupon, baseBasis.yieldPct, baseBasis.date, null);
      const modelMarkedPrice = solveBondPrice(record.coupon, markedYieldPct, baseBasis.date, null);
      if (modelBasePrice == null || modelMarkedPrice == null) return null;
      return record.askPrice + (modelMarkedPrice - modelBasePrice);
    }
    return record.askPrice + (commission.value / 10);
  }

  function commissionCorporateYieldHtml(record, key, decimals) {
    const baseYield = record && record[key];
    if (baseYield == null) return '<span class="no-restrict">&mdash;</span>';
    const base = Number(baseYield).toFixed(decimals == null ? 3 : decimals);
    const marked = markedCorporateValues(record);
    const markedYield = key === 'ytnc' ? marked && marked.markedYtnc : marked && marked.markedYtm;
    if (markedYield == null) return base;
    return `${base}${commissionSubline(`marked ${markedYield.toFixed(decimals == null ? 3 : decimals)}`)}`;
  }

  function renderCommissionControl(product, afterElementId) {
    const after = document.getElementById(afterElementId);
    if (!after || !commissionSettings[product]) return;
    const panelId = `${product}-commission-control`;
    let panel = document.getElementById(panelId);
    if (!panel) {
      panel = document.createElement('div');
      panel.id = panelId;
      panel.className = 'commission-control';
      after.insertAdjacentElement('afterend', panel);
    }
    const settings = commissionSettings[product];
    const scaleText = settings.method === 'bps'
      ? '10 bp = 0.10 price | 50 bp = 0.50 | 100 bp = 1.00'
      : '$1 = 0.10 price | $5 = 0.50 | $10 = 1.00';
    panel.innerHTML = `
      <label class="commission-toggle">
        <input type="checkbox" data-commission-enabled="${product}" ${settings.enabled ? 'checked' : ''}>
        <span>Add sales commission to ${escapeHtml(COMMISSION_PRODUCT_LABELS[product])}</span>
      </label>
      <label class="commission-field">
        <span>Method</span>
        <select data-commission-method="${product}">
          <option value="dollars" ${settings.method === 'dollars' ? 'selected' : ''}>Sales $</option>
          <option value="bps" ${settings.method === 'bps' ? 'selected' : ''}>Basis points</option>
        </select>
      </label>
      <label class="commission-field">
        <span>Sales $</span>
        <input type="number" min="0" max="100" step="0.25" value="${escapeHtml(settings.dollarMarkup)}" data-commission-dollars="${product}">
      </label>
      <label class="commission-field">
        <span>Basis points</span>
        <input type="number" min="0" max="1000" step="1" value="${escapeHtml(settings.bpMarkup)}" data-commission-bps="${product}">
      </label>
      <div class="commission-scale-note">${escapeHtml(scaleText)}</div>
    `;
  }

  function setupCommissionControls() {
    document.addEventListener('change', e => {
      const enabledProduct = e.target && e.target.dataset ? e.target.dataset.commissionEnabled : null;
      const methodProduct = e.target && e.target.dataset ? e.target.dataset.commissionMethod : null;
      if (enabledProduct && commissionSettings[enabledProduct]) {
        commissionSettings[enabledProduct].enabled = e.target.checked;
        saveCommissionSettings();
        refreshCommissionProduct(enabledProduct);
      }
      if (methodProduct && commissionSettings[methodProduct]) {
        commissionSettings[methodProduct].method = e.target.value === 'bps' ? 'bps' : 'dollars';
        saveCommissionSettings();
        renderCommissionControl(methodProduct, methodProduct === 'corporates' ? 'corpStatTiles' : 'agencyStatTiles');
        refreshCommissionProduct(methodProduct);
      }
    });
    document.addEventListener('input', e => {
      const dollarProduct = e.target && e.target.dataset ? e.target.dataset.commissionDollars : null;
      const bpProduct = e.target && e.target.dataset ? e.target.dataset.commissionBps : null;
      const product = dollarProduct || bpProduct;
      if (!product || !commissionSettings[product]) return;
      if (dollarProduct) commissionSettings[product].dollarMarkup = normalizeCommissionDollars(e.target.value);
      if (bpProduct) commissionSettings[product].bpMarkup = normalizeCommissionBps(e.target.value);
      saveCommissionSettings();
      refreshCommissionProduct(product);
    });
  }

  function refreshCommissionProduct(product) {
    if (product === 'agencies' && agencyData) renderAgencies();
    if (product === 'corporates' && corpData) renderCorporates();
  }

  function formatShortDate(dateStr) {
    if (!dateStr) return '—';
    try {
      const [y, m, d] = dateStr.split('-');
      const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
      return date.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      });
    } catch (e) { return dateStr; }
  }

  function formatNumericDate(dateStr) {
    if (!dateStr) return '—';
    try {
      const clean = dateStr instanceof Date ? null : String(dateStr).slice(0, 10);
      const date = dateStr instanceof Date
        ? dateStr
        : /^\d{4}-\d{2}-\d{2}$/.test(clean)
          ? new Date(parseInt(clean.slice(0, 4), 10), parseInt(clean.slice(5, 7), 10) - 1, parseInt(clean.slice(8, 10), 10))
          : new Date(dateStr);
      if (isNaN(date)) return dateStr;
      return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;
    } catch (e) { return dateStr; }
  }

  function formatTime(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit'
      });
    } catch (e) { return '—'; }
  }

  function formatSize(bytes) {
    if (bytes == null || isNaN(bytes)) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function formatNumber(n) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString();
  }

  function formatMoney(n, digits = 0) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: digits,
      minimumFractionDigits: digits
    });
  }

  function formatPercent(n, digits = 2) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toFixed(digits);
  }

  function formatPercentTile(n, digits = 2) {
    if (n == null || isNaN(n)) return '—';
    return `${formatPercent(n, digits)}%`;
  }

  function csvEscape(value) {
    let s = String(value ?? '');
    // Neutralize spreadsheet formula injection: a cell starting with = + - @ (or a
    // leading control char) can execute when the CSV is opened in Excel. Prefix a quote.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function downloadCsv(filename, rows) {
    const csv = rows.map(row => row.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function slugifyFilename(value) {
    return String(value || 'bank')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'bank';
  }

  // Generic CSP-safe printable for a rendered report panel (Bank Peer Analysis,
  // Opportunity Scan — both computed client-side). Clones the panel's current DOM
  // into a popup, links the app stylesheet (:root theme vars apply), hides
  // interactive controls, and prints from this context via opener.print() — so
  // the printed numbers match exactly what's on screen. The cloned innerHTML was
  // already escaped when the SPA rendered it.
  function printReportPanel(selector, title) {
    const el = document.querySelector(selector);
    if (!el || !el.textContent.trim() || /select a bank|no scan yet|run the scan|generate a peer/i.test(el.textContent)) {
      return showToast('Run the report first, then print', true);
    }
    const w = window.open('', '_blank');
    if (!w) return showToast('Allow pop-ups to print', true);
    const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    w.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
      <link rel="stylesheet" href="/css/portal.css">
      <style>
        body{margin:24px;background:#fff;}
        .print-banner{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #0f1f17;padding-bottom:8px;margin-bottom:14px;}
        .print-banner .firm{font-weight:800;text-transform:uppercase;letter-spacing:.04em;font-size:11px;}
        .print-banner .firm strong{display:block;font-size:16px;text-transform:none;letter-spacing:0;}
        button,input,select,textarea,.text-btn,.small-btn,.icon-btn,[data-reports-export],[data-coverage-export],[data-coverage-print],.reports-peer-search,.opportunity-actions{display:none !important;}
        @media print{@page{size:letter portrait;margin:.5in;} body{margin:0;}}
      </style></head><body>
      <div class="print-banner"><div class="firm">First Bankers' Banc Securities, Inc.<strong>${escapeHtml(title)}</strong></div><div style="font-size:11px;color:#4a5b53">${escapeHtml(dateStr)}</div></div>
      ${el.innerHTML}
      <div style="margin-top:18px;border-top:1px solid #c8d6cd;padding-top:8px;font-size:9.5px;color:#4a5b53">For Institutional Use Only. Internal strategy screen — desk review controls the final recommendation. First Bankers' Banc Securities, Inc. is a member of FINRA / SIPC.</div>
      </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch (e) {} }, 400);
  }

  // Unified export entry point for the Reports Workspace. CSV reuses the shared
  // downloadCsv()/csvEscape() helpers via each report's existing exporter;
  // portfolio-peer also supports a server-rendered Print/PDF handout.
  function exportReport(type, format) {
    if (format === 'pdf') {
      if (type === 'portfolio-peer') {
        const id = portfolioReviewState.selectedBankId;
        const review = portfolioReviewState.review;
        if (!id || !review || review.available === false) {
          return showToast('Run a portfolio review first', true);
        }
        window.open('/api/portfolio-review/render?bankId=' + encodeURIComponent(id), '_blank', 'noopener');
        return;
      }
      return showToast('Print / PDF is available for Portfolio Review in this phase', true);
    }
    // CSV — delegate to each report type's exporter.
    if (type === 'custom-bank') return exportCustomBankReportCsv();
    if (type === 'bank-peer') return exportPeerAnalysisCsv();
    if (type === 'opportunity') return exportOpportunityReportCsv();
    if (type === 'portfolio-peer') return exportPortfolioReviewCsv();
    if (type === 'billing-queue') return exportBillingQueueCsv();
    return showToast('CSV export is not available for this report type yet', true);
  }

  // Portfolio Review CSV: a summary block followed by the full holdings table.
  // Numbers are emitted raw (not $/%-formatted) so Excel keeps them numeric.
  function exportPortfolioReviewCsv() {
    const review = portfolioReviewState.review;
    if (!review || review.available === false) {
      return showToast('Run a portfolio review first', true);
    }
    const s = review.summary || {};
    const rows = [
      ['FBBS Portfolio Review'],
      ['Bank', review.bankName || ''],
      ['Location', [review.city, review.state].filter(Boolean).join(', ')],
      ['Cert', review.certNumber || ''],
      ['Portfolio Date', review.reportDate || ''],
      ['Inventory Date', review.inventoryDate || ''],
      ['Source File', review.sourceFile || ''],
      ['Tax Treatment', `${review.isSubchapterS ? 'Sub-S' : 'C-corp'} (${review.taxRate}%)`],
      ['Positions', s.positions],
      ['Par', s.par],
      ['Book Value', s.bookValue],
      ['Market Value', s.marketValue],
      ['Unrealized G/L', s.gainLoss],
      ['Unrealized G/L %', s.gainLossPct],
      ['Book Yield', s.bookYield],
      ['Market Yield', s.marketYield],
      ['Weighted Coupon', s.weightedCoupon],
      ['Weighted Avg Life', s.weightedAverageLife],
      ['Effective Duration', s.effectiveDuration],
      ['Yield on Securities', s.yieldOnSecurities],
      ['NIM', s.netInterestMargin],
      ['Cost of Funds', s.costOfFunds],
      [],
      ['Holdings'],
      ['Sector', 'CUSIP', 'Description', 'Coupon', 'Maturity', 'Next Call', 'Classification',
        'Par', 'Book Value', 'Market Value', 'Gain/Loss', 'Gain/Loss %', 'Book Price', 'Market Price',
        'Book Yield', 'Market Yield', 'Yield Gap', 'Avg Life', 'Eff Duration', 'OAS (bp)', 'Callable']
    ];
    (review.holdings || []).forEach(h => rows.push([
      h.sector, h.cusip, h.description, h.coupon, h.maturity, h.nextCall, h.classification,
      h.par, h.bookValue, h.marketValue, h.gainLoss, h.gainLossPct, h.bookPrice, h.marketPrice,
      h.bookYield, h.marketYield, h.yieldGap, h.averageLife, h.effectiveDuration, h.oasBp,
      h.callable ? 'Yes' : 'No'
    ]));
    if ((review.sectors || []).length) {
      rows.push([], ['Sector Mix'], ['Sector', 'Count', 'Par', 'Market Value', '% of Market']);
      review.sectors.forEach(se => rows.push([
        se.sector || se.label, se.count, se.par, se.marketValue,
        se.pctOfMarket != null ? se.pctOfMarket : se.weight
      ]));
    }
    const stamp = review.reportDate || 'current';
    downloadCsv(`portfolio_review_${slugifyFilename(review.bankName)}_${stamp}.csv`, rows);
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function average(values) {
    const nums = values.filter(v => v != null && !isNaN(v));
    if (!nums.length) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  function maxValue(values) {
    const nums = values.filter(v => v != null && !isNaN(v));
    return nums.length ? Math.max(...nums) : null;
  }

  function minDate(values) {
    const dates = values.filter(Boolean).sort();
    return dates.length ? dates[0] : null;
  }

  function mostCommonTerm(offerings) {
    const counts = new Map();
    offerings.forEach(o => {
      if (!o.term) return;
      const existing = counts.get(o.term) || { term: o.term, count: 0, termMonths: o.termMonths };
      existing.count += 1;
      if (existing.termMonths == null && o.termMonths != null) existing.termMonths = o.termMonths;
      counts.set(o.term, existing);
    });
    const top = [...counts.values()].sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (a.termMonths == null) return 1;
      if (b.termMonths == null) return -1;
      return a.termMonths - b.termMonths;
    })[0];
    return top ? `${top.term} (${formatNumber(top.count)})` : '—';
  }

  function renderStatTiles(targetId, tiles) {
    const el = document.getElementById(targetId);
    if (!el) return;
    el.innerHTML = tiles.map(t => `
      <div class="stat-tile">
        <span>${escapeHtml(t.label)}</span>
        <strong>${escapeHtml(String(t.value ?? '—'))}</strong>
      </div>
    `).join('');
  }

  function renderHomeMarketTiles() {
    const cds = marketData.cds || [];
    const treasuries = marketData.treasuryNotes || [];
    const munis = marketData.munis || [];
    const agencies = marketData.agencies || [];
    const corporates = marketData.corporates || [];
    const callableAgencies = agencies.filter(o => o.structure === 'Callable').length;
    const igCorporates = corporates.filter(o => o.investmentGrade).length;
    const hyCorporates = corporates.filter(o => !o.investmentGrade).length;

    renderStatTiles('homeMarketTiles', [
      { label: 'Highest CD Rate', value: formatPercentTile(maxValue(cds.map(o => o.rate)), 2) },
      { label: 'Most Common CD Term', value: mostCommonTerm(cds) },
      { label: 'Callable Agencies', value: formatNumber(callableAgencies) },
      { label: 'Corporates IG / HY', value: corporates.length ? `${formatNumber(igCorporates)} / ${formatNumber(hyCorporates)}` : '—' },
      { label: 'Average Agency YTM', value: formatPercentTile(average(agencies.map(o => o.ytm)), 3) },
      { label: 'Average Corp YTM', value: formatPercentTile(average(corporates.map(o => o.ytm)), 3) }
    ]);
  }

  function renderHomeStatusTiles(filled) {
    const pkg = currentPackage || {};
    const dateText = qualitySummary.datesMatch == null
      ? 'No date check'
      : (qualitySummary.datesMatch ? 'Dates aligned' : 'Check dates');
    const warningText = qualitySummary.warnings
      ? `${qualitySummary.warnings} warning${qualitySummary.warnings === 1 ? '' : 's'}`
      : 'Clean';

    renderStatTiles('homeStatusTiles', [
      { label: 'Package', value: `${packageCountText(pkg)} files` },
      { label: 'Published', value: pkg.publishedAt ? formatTime(pkg.publishedAt) : 'Not yet' },
      { label: 'Data Health', value: warningText },
      { label: 'Date Check', value: dateText }
    ]);
  }

  function packageUploadedCount(pkg) {
    pkg = pkg || {};
    const canonical = SLOTS.filter(slot => pkg[slot]).length;
    const companionCount = pkg.cdoffersCost && !SLOTS.includes('cdoffersCost') ? 1 : 0;
    return Math.min(TOTAL_SLOTS, canonical + companionCount);
  }

  function packageCountText(pkg) {
    return `${packageUploadedCount(pkg)} / ${TOTAL_SLOTS}`;
  }

  function homeMissingDocs() {
    const pkg = currentPackage || {};
    return SLOTS
      .filter(slot => !pkg[slot])
      .map(slot => DOC_TYPES[slot].label);
  }

  function homeWorkItemHtml(item) {
    return `
      <button type="button" class="home-work-item ${item.tone || ''}" data-goto="${escapeHtml(item.page)}">
        <span>${escapeHtml(item.kicker)}</span>
        <strong>${escapeHtml(item.title)}</strong>
        <em>${escapeHtml(item.detail)}</em>
      </button>
    `;
  }

  function renderHomeWorkList(filled) {
    const target = document.getElementById('homeWorkList');
    if (!target) return;
    const pkg = currentPackage || {};
    const missing = homeMissingDocs();
    const items = [];
    const strategyCounts = strategyNotifications.counts || {};
    const needsBilled = Number(strategyCounts['Needs Billed'] || 0);
    const inProgress = Number(strategyCounts['In Progress'] || 0);
    const openStrategies = Number(strategyCounts.Open || 0);

    if (filled < TOTAL_SLOTS) {
      items.push({
        page: 'upload',
        tone: 'attention',
        kicker: 'Publish',
        title: `${TOTAL_SLOTS - filled} file${TOTAL_SLOTS - filled === 1 ? '' : 's'} missing`,
        detail: missing.slice(0, 2).join(', ') + (missing.length > 2 ? ` + ${missing.length - 2} more` : '')
      });
    } else {
      items.push({
        page: 'archive',
        tone: 'ok',
        kicker: 'Published',
        title: `Package ready for ${formatShortDate(pkg.date)}`,
        detail: `Last published ${formatTime(pkg.publishedAt)}`
      });
    }

    if (qualitySummary.datesMatch === false || qualitySummary.warnings > 0) {
      items.push({
        page: 'upload',
        tone: 'attention',
        kicker: 'Review',
        title: qualitySummary.datesMatch === false ? 'Date mismatch detected' : 'Parser warnings detected',
        detail: qualitySummary.countsText || 'Review upload quality before sharing'
      });
    }

    if (needsBilled > 0) {
      items.push({
        page: 'strategies',
        tone: 'attention',
        kicker: 'Billing',
        title: `${formatNumber(needsBilled)} strateg${needsBilled === 1 ? 'y' : 'ies'} need${needsBilled === 1 ? 's' : ''} billed`,
        detail: 'Review invoice contact and archive after billing'
      });
    }

    if (openStrategies > 0 || inProgress > 0) {
      items.push({
        page: 'strategies',
        kicker: 'Strategies',
        title: `${formatNumber(openStrategies)} open · ${formatNumber(inProgress)} in progress`,
        detail: 'Bond swaps, BCIS, CECL, and miscellaneous requests'
      });
    }

    items.push({
      page: 'banks',
      kicker: 'Coverage',
      title: 'Open bank tear sheets',
      detail: 'Search banks, saved coverage, and notes'
    });

    items.push({
      page: 'cd-recap',
      kicker: 'CDs',
      title: 'Review weekly CD recap',
      detail: 'Deduped CUSIPs, term counts, and rate changes'
    });

    target.innerHTML = items.map(homeWorkItemHtml).join('');
  }

  function renderHomeLaunchGrid() {
    const target = document.getElementById('homeLaunchGrid');
    if (!target) return;
    const cds = marketData.cds || [];
    const munis = marketData.munis || [];
    const agencies = marketData.agencies || [];
    const corporates = marketData.corporates || [];
    const strategyCounts = strategyNotifications.counts || {};
    const cards = [
      { page: 'strategies', label: 'Strategies', title: 'Strategies Queue', detail: 'Track Bond Swap, Muni BCIS, THO, CECL, miscellaneous, and billing requests.', metric: `${formatNumber(strategyCounts.Open || 0)} open` },
      { page: 'bond-swap', label: 'Bond Swap', title: 'Bond Swap', detail: 'Portfolio Idea Engine and multi-leg swap-proposal builder for bond-accounting banks.', metric: 'Swap builder' },
      { page: 'banks', label: 'Banks', title: 'Bank Tear Sheets', detail: 'Call report tear sheets, saved banks, notes, and coverage status.', metric: 'Coverage workspace' },
      { page: 'treasury-explorer', label: 'Treasuries', title: 'Treasury Explorer', detail: 'Review uploaded Treasury Notes by CUSIP, coupon, maturity, yield, price, and spread.', metric: `${formatNumber(treasuries.length)} notes` },
      { page: 'explorer', label: 'CDs', title: 'CD Explorer', detail: 'Search daily CD offerings by issuer, CUSIP, term, rate, and restrictions.', metric: `${formatNumber(cds.length)} CDs` },
      { page: 'muni-explorer', label: 'Munis', title: 'Muni Explorer', detail: 'Browse municipal offerings by issuer, state, rating, yield, and call status.', metric: `${formatNumber(munis.length)} munis` },
      { page: 'agencies', label: 'Agencies', title: 'Agency Explorer', detail: 'Review bullet and callable agencies with commission-adjusted context.', metric: `${formatNumber(agencies.length)} offerings` },
      { page: 'corporates', label: 'Corporates', title: 'Corporate Explorer', detail: 'Filter corporate inventory by issuer, ticker, sector, yield, and rating.', metric: `${formatNumber(corporates.length)} bonds` }
    ];

    target.innerHTML = cards.map(card => `
      <button type="button" class="home-launch-card" data-goto="${escapeHtml(card.page)}">
        <span>${escapeHtml(card.label)}</span>
        <strong>${escapeHtml(card.title)}</strong>
        <em>${escapeHtml(card.detail)}</em>
        <b>${escapeHtml(card.metric)}</b>
      </button>
    `).join('');
  }

  async function fetchOptionalJson(path) {
    try {
      const res = await fetch(path, { cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.warn(`Unable to load ${path}:`, e);
      return null;
    }
  }

  async function loadQualitySummary() {
    const [cds, treasuries, munis, agencies, corporates] = await Promise.all([
      fetchOptionalJson('/api/offerings'),
      fetchOptionalJson('/api/treasury-notes'),
      fetchOptionalJson('/api/muni-offerings'),
      fetchOptionalJson('/api/agencies'),
      fetchOptionalJson('/api/corporates')
    ]);

    const datasets = [cds, treasuries, munis, agencies, corporates].filter(Boolean);
    marketData = {
      cds: Array.isArray(cds && cds.offerings) ? cds.offerings : [],
      treasuryNotes: Array.isArray(treasuries && treasuries.notes) ? treasuries.notes : [],
      munis: Array.isArray(munis && munis.offerings) ? munis.offerings : [],
      agencies: Array.isArray(agencies && agencies.offerings) ? agencies.offerings : [],
      corporates: Array.isArray(corporates && corporates.offerings) ? corporates.offerings : []
    };
    const warnings = datasets.reduce((sum, data) => (
      sum + (Array.isArray(data.warnings) ? data.warnings.length : 0)
    ), 0);

    const pkg = currentPackage || {};
    const packageDates = [
      pkg.date,
      cds && cds.asOfDate,
      treasuries && treasuries.asOfDate,
      munis && munis.asOfDate,
      agencies && agencies.fileDate,
      corporates && corporates.fileDate
    ].filter(Boolean);
    const uniqueDates = [...new Set(packageDates)];

    const countParts = [
      pkg.offeringsCount != null ? `${formatNumber(pkg.offeringsCount)} CDs` : null,
      pkg.treasuryNotesCount != null ? `${formatNumber(pkg.treasuryNotesCount)} treasuries` : null,
      pkg.muniOfferingsCount != null ? `${formatNumber(pkg.muniOfferingsCount)} munis` : null,
      pkg.agencyCount != null ? `${formatNumber(pkg.agencyCount)} agencies` : null,
      pkg.corporatesCount != null ? `${formatNumber(pkg.corporatesCount)} corporates` : null
    ].filter(Boolean);

    qualitySummary = {
      warnings,
      datesMatch: packageDates.length ? uniqueDates.length <= 1 : null,
      countsText: countParts.length ? countParts.join(' · ') : '—'
    };
  }

  function renderQualityStatus(filled) {
    const fileText = `${filled} / ${TOTAL_SLOTS}`;
    const dateText = qualitySummary.datesMatch == null
      ? '—'
      : (qualitySummary.datesMatch ? 'Dates match' : 'Check dates');
    const warningsText = qualitySummary.warnings
      ? `${qualitySummary.warnings} warning${qualitySummary.warnings === 1 ? '' : 's'}`
      : 'No warnings';

    setText('uploadQualityFiles', fileText);
    setText('uploadQualityDates', dateText);
    setText('uploadQualityCounts', qualitySummary.countsText);
    setText('uploadQualityWarnings', warningsText);

    ['uploadQualityDates'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('warn', qualitySummary.datesMatch === false);
      el.classList.toggle('ok', qualitySummary.datesMatch === true);
    });
    ['uploadQualityWarnings'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('warn', qualitySummary.warnings > 0);
      el.classList.toggle('ok', qualitySummary.warnings === 0);
    });
  }

  /**
   * Client-side filename classifier — mirrors the server logic so we can warn
   * the user if they drop a file into what looks like the wrong slot.
   */
  function classifyFile(filename) {
    if (!filename) return null;
    const lower = filename.toLowerCase();
    if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'dashboard';
    if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm') || lower.endsWith('.xls')) {
      if ((lower.includes('treasury') || lower.includes('tsy')) &&
          (lower.includes('note') || lower.includes('notes'))) return 'treasuryNotes';
      if (lower.includes('baird') || lower.includes('syndicate')) return 'bairdSyndicate';
      if (lower.includes('cd_offer') || lower.includes('cdoffer') ||
          lower.includes('daily_cd') || lower.includes('daily cd') ||
          lower.includes('cd offering') || lower.includes('cd_offering') ||
          lower.includes('new issue cd') || lower.includes('new issue cds') ||
          lower.includes('cds - cost')) return 'cdoffers';
      if (lower.includes('corporate') || lower.includes('corp_')) return 'corporates';
      if (lower.includes('callable') || lower.includes('call')) return 'agenciesCallables';
      if (lower.includes('bullet')) return 'agenciesBullets';
      return 'agenciesBullets';  // ambiguous → default; user can drop into the right slot
    }
    if (lower.endsWith('.pdf')) {
      if (lower.includes('mmd') || lower.includes('municipal market data')) return 'mmd';
      if (lower.includes('relative_value') || lower.includes('relative value') ||
          lower.includes('relative_val') || lower.includes('relativevalue')) return 'relativeValue';
      const isMuni =
        (lower.includes('fbbs_offering') || lower.includes('fbbs offering') ||
         lower.includes('muni_offering')  || lower.includes('muni offering')  ||
         lower.includes('municipal_offering') || lower.includes('municipal offering'))
        && !lower.includes('cd_offer') && !lower.includes('cdoffer') && !lower.includes('cd offer');
      if (isMuni) return 'munioffers';
      if (lower.includes('cd_offer') || lower.includes('cdoffer') ||
          lower.includes('daily_cd') || lower.includes('daily cd') ||
          lower.includes('cd offering') || lower.includes('cd_offering')) return 'cdoffers';
      if (lower.includes('cd_rate') || lower.includes('brokered_cd') ||
          lower.includes('brokered cd') || lower.includes('rate_sheet') ||
          lower.includes('rate sheet')) return 'cd';
      return 'econ';
    }
    return null;
  }

  // ============ Navigation ============

  function parseHashTarget(hashValue) {
    const raw = String(hashValue || '').replace(/^#/, '') || 'home';
    const [page, query = ''] = raw.split('?');
    const [basePage, ...subpathParts] = page.split('/').filter(Boolean);
    return {
      page: VALID_PAGES.includes(basePage) ? basePage : 'home',
      subpath: subpathParts.join('/'),
      query
    };
  }

  function hashParamsForPage(pageName) {
    const parsed = parseHashTarget(window.location.hash || '#home');
    return parsed.page === pageName ? new URLSearchParams(parsed.query || '') : new URLSearchParams();
  }

  function replaceHashParams(pageName, values) {
    const parsed = parseHashTarget(window.location.hash || '#home');
    if (parsed.page !== pageName) return;
    const params = new URLSearchParams();
    Object.entries(values || {}).forEach(([key, value]) => {
      if (value == null || value === '' || value === false) return;
      if (value instanceof Set) {
        if (value.size) params.set(key, Array.from(value).join(','));
        return;
      }
      params.set(key, String(value));
    });
    const nextHash = `#${pageName}${params.toString() ? '?' + params.toString() : ''}`;
    if (window.location.hash !== nextHash) history.replaceState(null, '', nextHash);
  }

  function hashParamSet(params, key) {
    const value = params.get(key);
    return new Set(value ? value.split(',').map(item => item.trim()).filter(Boolean) : []);
  }

  function setControlValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value == null ? '' : String(value);
  }

  function setControlChecked(id, checked) {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(checked);
  }

  function setCheckedValues(selector, values) {
    const set = values instanceof Set ? values : new Set(values || []);
    document.querySelectorAll(selector).forEach(el => {
      el.checked = set.has(el.value);
    });
  }

  function numberOrNull(value) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }

  function isProductionAuthMode() {
    return Boolean(meState.auth && meState.auth.mode === 'iis');
  }

  function isAdminUiAllowed() {
    if (!meState.auth || meState.auth.loadFailed) return false;
    return !isProductionAuthMode() || Boolean(meState.auth && meState.auth.isAdmin);
  }

  function applyAuthUi() {
    const allowAdmin = isAdminUiAllowed();
    document.querySelectorAll('[data-page="upload"], [data-goto="upload"], [data-page="admin"], [data-goto="admin"]').forEach(el => {
      el.hidden = !allowAdmin;
      el.setAttribute('aria-hidden', allowAdmin ? 'false' : 'true');
    });
    const active = parseHashTarget(window.location.hash || '#home').page;
    if (!allowAdmin && (active === 'upload' || active === 'admin')) {
      showToast('Admin permission is required for that page.', true);
      goTo('package-qa');
    }
  }

  function goTo(pageName, { updateHash = true } = {}) {
    pageName = parseHashTarget(pageName).page;
    if (!VALID_PAGES.includes(pageName)) pageName = 'home';
    if (!isAdminUiAllowed() && (pageName === 'upload' || pageName === 'admin')) {
      showToast('Admin permission is required for that page.', true);
      pageName = 'package-qa';
    }

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.nav-link[aria-current="page"]').forEach(n => n.removeAttribute('aria-current'));
    document.querySelectorAll('.top-strip-links [data-page]').forEach(n => n.classList.remove('active'));

    const page = document.getElementById('p-' + pageName);
    if (page) page.classList.add('active');

    const link = document.querySelector('.nav-link[data-page="' + pageName + '"]');
    if (link) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
    document.querySelectorAll('.top-strip-links [data-page="' + pageName + '"]').forEach(n => n.classList.add('active'));
    updateMarketNavGroup(pageName);

    window.scrollTo({ top: 0, behavior: 'auto' });
    closeNavSearch();

    if (updateHash && window.location.hash !== '#' + pageName) {
      history.replaceState(null, '', '#' + pageName);
    }

    if (pageName === 'home') renderHomeRecents();
    if (pageName === 'views') loadSavedViewSummaries();
    if (pageName === 'daily-intelligence') loadDailyIntelligence();
    if (pageName === 'relativeValue') {
      loadRelativeValueSnapshot();
    }
    if (pageName === 'mmd') {
      loadMmdCurve();
    }
    if (pageName === 'archive') loadArchive();
    if (pageName === 'cd-recap') loadCdRecap();
    if (pageName === 'cd-internal') loadCdInternal();
    if (pageName === 'treasury-explorer') loadTreasuryNotes();
    if (pageName === 'explorer') loadOfferings();
    if (pageName === 'muni-explorer') loadMuniOfferings();
    if (pageName === 'agencies') loadAgencies();
    if (pageName === 'corporates') loadCorporates();
    if (pageName === 'mbs-cmo') loadMbsCmo();
    if (pageName === 'structured-notes') loadStructuredNotes();
    if (pageName === 'market-color') loadMarketColor();
    if (pageName === 'banks') {
      loadBankStatus();
      loadSavedBanks();
      loadAccountCoverageAccounts();
      // Quietly populate the cohort picker for tear-sheet "compare against".
      // Failure is non-fatal — the picker just won't render.
      fetch('/api/peer-groups', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data && Array.isArray(data.peerGroups)) {
            peerGroupsState.cohorts = data.peerGroups;
            if (selectedBank && selectedBank.bank && pageName === 'banks') renderBankProfile();
          }
        })
        .catch(() => {});
    }
    if (pageName === 'maps') loadMaps();
    if (pageName === 'reports') {
      loadBankStatus();
      loadBondAccountingManifest();
      renderReportsWorkspace();
    }
    if (pageName === 'strategies') {
      // Back-compat: Bond Swap used to live under #strategies?tab=bond-swap.
      // It's now its own top-level page — forward old deep links to it.
      const sp = hashParamsForPage('strategies');
      if (sp.get('tab') === 'bond-swap') {
        const fwd = new URLSearchParams();
        if (sp.get('bank')) fwd.set('bank', sp.get('bank'));
        if (sp.get('proposal')) fwd.set('proposal', sp.get('proposal'));
        window.location.hash = '#bond-swap' + (fwd.toString() ? '?' + fwd.toString() : '');
        return;
      }
      loadStrategies();
    }
    if (pageName === 'bond-swap') enterBondSwapPage();
    if (pageName === 'peer-groups') loadPeerGroups();
    if (pageName === 'upload') loadBankStatus();
    if (pageName === 'package-qa') renderPackageQa();
    if (pageName === 'admin') loadAuditLog();
  }

  // Expose for inline handlers that still use it (belt + braces)
  window.goTo = goTo;

  // Wire up nav + any data-goto buttons via event delegation
  document.addEventListener('click', e => {
    const target = e.target.closest('[data-page], [data-goto]');
    if (!target) return;
    // Don't intercept external links or the CTA
    if (target.classList.contains('nav-cta')) return;
    if (target.getAttribute('target') === '_blank') return;

    const dest = target.dataset.page || target.dataset.goto;
    if (dest && VALID_PAGES.includes(dest)) {
      e.preventDefault();
      goTo(dest);
    }
  });

  window.addEventListener('hashchange', () => {
    const h = parseHashTarget(window.location.hash || '#home').page;
    goTo(h, { updateHash: false });
  });

  function updateMarketNavGroup(pageName) {
    document.querySelectorAll('.nav-group.active-group').forEach(group => {
      group.classList.remove('active-group');
    });
    const groupName = NAV_GROUP_BY_PAGE[pageName];
    if (!groupName) return;
    const group = document.querySelector(`.nav-group[data-nav-group="${groupName}"]`);
    if (!group) return;
    group.classList.add('active-group', 'open');
    const toggle = group.querySelector('.nav-parent');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
  }

  function setupMarketNav() {
    document.querySelectorAll('[data-nav-toggle]').forEach(toggle => {
      toggle.addEventListener('click', () => {
        const group = toggle.closest('.nav-group');
        if (!group) return;
        const isOpen = group.classList.toggle('open');
        toggle.setAttribute('aria-expanded', String(isOpen));
      });
    });
    setupTopMenuKeyboard();
  }

  function setupTopMenuKeyboard() {
    document.querySelectorAll('.top-link-menu').forEach((menu, menuIndex) => {
      const trigger = menu.querySelector('.top-link-trigger');
      const links = Array.from(menu.querySelectorAll('.top-link-menu-panel a'));
      if (!trigger || !links.length || menu.dataset.keyboardBound) return;
      menu.dataset.keyboardBound = '1';
      const panel = menu.querySelector('.top-link-menu-panel');
      if (panel) {
        if (!panel.id) panel.id = 'top-link-panel-' + menuIndex;
        trigger.setAttribute('aria-controls', panel.id);
      }
      const openMenu = () => {
        menu.classList.add('keyboard-open');
        trigger.setAttribute('aria-expanded', 'true');
      };
      const closeMenu = () => {
        menu.classList.remove('keyboard-open');
        trigger.setAttribute('aria-expanded', 'false');
      };
      const focusLink = index => {
        openMenu();
        links[(index + links.length) % links.length].focus();
      };
      trigger.setAttribute('aria-haspopup', 'true');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          focusLink(0);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          focusLink(links.length - 1);
        } else if (event.key === 'Escape') {
          closeMenu();
        }
      });
      links.forEach((link, index) => {
        link.addEventListener('keydown', event => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            focusLink(index + 1);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            focusLink(index - 1);
          } else if (event.key === 'Home') {
            event.preventDefault();
            focusLink(0);
          } else if (event.key === 'End') {
            event.preventDefault();
            focusLink(links.length - 1);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            closeMenu();
            trigger.focus();
          }
        });
        link.addEventListener('click', closeMenu);
      });
      menu.addEventListener('focusout', () => {
        setTimeout(() => {
          if (!menu.contains(document.activeElement)) closeMenu();
        }, 0);
      });
    });
  }

  function formatTooltipYield(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `${n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}%`;
  }

  function setupChartTooltips() {
    let tooltip = document.getElementById('chartTooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'chartTooltip';
      tooltip.className = 'chart-tooltip';
      tooltip.hidden = true;
      document.body.appendChild(tooltip);
    }
    const move = event => {
      const target = event.target.closest('[data-chart-tooltip]');
      if (!target) return;
      tooltip.textContent = target.dataset.chartTooltip || '';
      tooltip.hidden = false;
      const pad = 14;
      const rect = tooltip.getBoundingClientRect();
      const left = Math.min(window.innerWidth - rect.width - 8, event.clientX + pad);
      const top = Math.max(8, event.clientY - rect.height - pad);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseover', move);
    document.addEventListener('mouseout', event => {
      if (event.target.closest('[data-chart-tooltip]')) tooltip.hidden = true;
    });
  }

  function setupNavSearch() {
    const input = document.getElementById('navSearchInput');
    const results = document.getElementById('navSearchResults');
    if (!input || !results) return;

    let activeIndex = -1;

    const optionEls = () => Array.from(results.querySelectorAll('[data-goto]'));

    const setActive = (index) => {
      const opts = optionEls();
      if (!opts.length) { activeIndex = -1; return; }
      activeIndex = (index + opts.length) % opts.length;
      opts.forEach((el, i) => el.classList.toggle('is-active', i === activeIndex));
      opts[activeIndex].scrollIntoView({ block: 'nearest' });
    };

    const render = () => {
      const query = input.value.trim().toLowerCase();
      if (!query) {
        results.classList.remove('show');
        results.innerHTML = '';
        activeIndex = -1;
        return;
      }
      const terms = query.split(/\s+/).filter(Boolean);
      const matches = NAV_ITEMS.filter(item => {
        const haystack = `${item.group} ${item.label} ${item.description} ${item.aliases}`.toLowerCase();
        return terms.every(term => haystack.includes(term));
      }).slice(0, 7);

      results.classList.add('show');
      results.innerHTML = matches.length ? matches.map(item => `
        <button type="button" class="jump-result" data-goto="${item.page}">
          <span>${escapeHtml(item.group)}</span>
          <strong>${escapeHtml(item.label)}</strong>
          <em>${escapeHtml(item.description)}</em>
        </button>
      `).join('') : '<div class="jump-empty">No matching pages found</div>';
      // Highlight the first match so Enter has an obvious target.
      activeIndex = -1;
      if (matches.length) setActive(0);
    };

    input.addEventListener('input', render);
    input.addEventListener('focus', render);
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeNavSearch();
        input.blur();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(activeIndex + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(activeIndex - 1);
      } else if (e.key === 'Enter') {
        const opts = optionEls();
        const target = opts[activeIndex] || opts[0];
        if (target) {
          e.preventDefault();
          goTo(target.dataset.goto);
        }
      }
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('.portal-jump')) closeNavSearch();
    });
  }

  function closeNavSearch() {
    const input = document.getElementById('navSearchInput');
    const results = document.getElementById('navSearchResults');
    if (input) input.value = '';
    if (results) {
      results.classList.remove('show');
      results.innerHTML = '';
    }
  }

  // ============ Initial load ============

  function setHeaderDate() {
    const now = new Date();
    const heroDate = document.getElementById('heroDate');
    if (heroDate) {
      heroDate.textContent = now.toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
      });
    }
    const uploadDate = document.getElementById('uploadDate');
    if (uploadDate) {
      uploadDate.textContent = 'Target: ' + now.toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric'
      });
    }
  }

  async function loadCurrent() {
    try {
      const res = await fetch('/api/current', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      currentPackage = await res.json();
    } catch (e) {
      console.error('Failed to load current package:', e);
      currentPackage = {};
    }
    await loadQualitySummary();
    renderQualityStatus(packageUploadedCount(currentPackage));
    updateUploadStat();
    await loadEconomicUpdate();
    renderHome();
    renderViewer('dashboard');
    renderViewer('econ');
    renderViewer('relativeValue');
    renderViewer('treasuryNotes');
    renderViewer('cd');
    renderViewer('cdoffers');
    renderViewer('munioffers');
    renderCdCostCalculator();
    if (document.getElementById('p-relativeValue')?.classList.contains('active')) {
      loadRelativeValueSnapshot();
    }
    if (document.getElementById('p-mmd')?.classList.contains('active')) {
      loadMmdCurve();
    }
    if (document.getElementById('p-daily-intelligence')?.classList.contains('active')) {
      loadDailyIntelligence();
    }
  }

  async function loadArchive() {
    try {
      const res = await fetch('/api/archive', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      archiveData = await res.json();
    } catch (e) {
      console.error('Failed to load archive:', e);
      archiveData = [];
    }
    renderArchive();
  }

  // ============ Home ============

  function renderHome() {
    const pkg = currentPackage || {};
    const filled = packageUploadedCount(pkg);
    const subtitle = document.getElementById('homeSubtitle');
    const packageStat = document.getElementById('homePackageStat');
    if (packageStat) packageStat.textContent = `${filled}/${TOTAL_SLOTS}`;

    if (filled === 0) {
      if (subtitle) subtitle.textContent = 'No package has been published yet.';
    } else if (filled === TOTAL_SLOTS) {
      if (subtitle) subtitle.textContent = `Complete package for ${formatShortDate(pkg.date)}`;
    } else {
      if (subtitle) subtitle.textContent = `${filled} of ${TOTAL_SLOTS} package files are ready.`;
    }

    renderHomeStatusPill(pkg, filled);
    renderHomeTiles();
    renderHomeShowcase(pkg);
    renderHomeRecents();
  }

  function renderHomeTiles() {
    renderHomeTileAccounts();
    renderHomeTileMarkets();
    renderHomeTileDaily();
    renderHomeTileStrategies();
    renderMyWork();
  }

  // ============ My Work (rep identity) ============

  async function loadMe() {
    try {
      const res = await fetch('/api/me', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      meState.rep = data.rep || null;
      meState.auth = data.auth || { allowRepOverride: true, mode: 'local', isAdmin: false };
    } catch (e) {
      console.error('Failed to load /api/me:', e);
      meState.rep = null;
      meState.auth = { allowRepOverride: false, mode: 'unknown', isAdmin: false, loadFailed: true };
    }
    renderRepPicker();
    applyAuthUi();
    await loadMyWork();
  }

  async function loadKnownReps() {
    if (meState.repsLoaded) return;
    try {
      const res = await fetch('/api/me/reps', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      meState.knownReps = Array.isArray(data.reps) ? data.reps : [];
      meState.repsLoaded = true;
    } catch (e) {
      console.error('Failed to load /api/me/reps:', e);
      meState.knownReps = [];
    }
    renderRepPickerList();
  }

  async function loadMyWork() {
    if (meState.workLoading) return;
    meState.workLoading = true;
    try {
      const res = await fetch('/api/me/work', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      meState.work = await res.json();
    } catch (e) {
      console.error('Failed to load /api/me/work:', e);
      meState.work = null;
    } finally {
      meState.workLoading = false;
    }
    renderMyWork();
  }

  async function setRepOverride(rep) {
    try {
      const body = rep
        ? { username: rep.username, displayName: rep.displayName }
        : { username: null };
      const res = await fetch('/api/me/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      meState.rep = data.rep || null;
    } catch (e) {
      console.error('Failed to set rep override:', e);
    }
    closeRepPanel();
    renderRepPicker();
    await loadMyWork();
    if (parseHashTarget(window.location.hash || '#home').page === 'views') {
      savedViewsState.selectedResult = null;
      await loadSavedViewSummaries();
      if (savedViewsState.selectedId) openSavedView(savedViewsState.selectedId);
    }
  }

  function renderRepPicker() {
    const nameEl = document.getElementById('repPickerName');
    const hintEl = document.getElementById('repPickerHint');
    const trigger = document.getElementById('repPickerTrigger');
    if (!nameEl || !trigger) return;
    const rep = meState.rep;
    const allowOverride = !meState.auth || meState.auth.allowRepOverride !== false;
    const kicker = trigger.querySelector('.rep-picker-kicker');
    const caret = trigger.querySelector('.rep-picker-caret');
    if (kicker) kicker.textContent = allowOverride ? 'Acting as' : 'Signed in';
    if (caret) caret.style.display = allowOverride ? '' : 'none';
    trigger.disabled = !allowOverride;
    trigger.setAttribute('aria-haspopup', allowOverride ? 'true' : 'false');
    if (rep) {
      nameEl.textContent = rep.displayName || rep.username;
      trigger.classList.add('is-set');
      if (hintEl) {
        const sourceLabel = rep.source === 'iis'
          ? 'Detected from Windows login'
          : rep.source === 'env'
            ? 'Default from FBBS_DEFAULT_REP'
            : 'Manual override';
        hintEl.textContent = sourceLabel;
      }
    } else {
      nameEl.textContent = 'Set rep';
      trigger.classList.remove('is-set');
      if (hintEl) hintEl.textContent = 'No rep selected. My Work tiles stay empty until one is set.';
    }
  }

  function renderRepPickerList() {
    const listEl = document.getElementById('repPickerList');
    if (!listEl) return;
    const q = (meState.searchQuery || '').toLowerCase().trim();
    const reps = meState.knownReps || [];
    const filtered = q
      ? reps.filter(r => (r.displayName || '').toLowerCase().includes(q) || (r.username || '').toLowerCase().includes(q))
      : reps;
    if (!filtered.length) {
      listEl.innerHTML = '<li class="rep-picker-empty">No reps found. Import the account-statuses workbook first.</li>';
      return;
    }
    const currentUsername = meState.rep && meState.rep.username ? meState.rep.username : '';
    listEl.innerHTML = filtered.slice(0, 60).map(rep => {
      const isCurrent = rep.username === currentUsername;
      return `
        <li>
          <button type="button" class="rep-picker-item${isCurrent ? ' is-current' : ''}"
                  data-rep-username="${escapeHtml(rep.username)}"
                  data-rep-display="${escapeHtml(rep.displayName || rep.username)}">
            <span class="rep-picker-item-name">${escapeHtml(rep.displayName || rep.username)}</span>
            <span class="rep-picker-item-count">${formatNumber(rep.count || 0)}</span>
          </button>
        </li>
      `;
    }).join('');
  }

  function openRepPanel() {
    const panel = document.getElementById('repPickerPanel');
    const trigger = document.getElementById('repPickerTrigger');
    if (!panel || !trigger) return;
    if (meState.auth && meState.auth.allowRepOverride === false) return;
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    meState.panelOpen = true;
    loadKnownReps();
    const searchEl = document.getElementById('repPickerSearch');
    if (searchEl) {
      searchEl.value = '';
      meState.searchQuery = '';
      setTimeout(() => searchEl.focus(), 0);
    }
  }

  function closeRepPanel() {
    const panel = document.getElementById('repPickerPanel');
    const trigger = document.getElementById('repPickerTrigger');
    if (panel) panel.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    meState.panelOpen = false;
  }

  function setupRepPicker() {
    const trigger = document.getElementById('repPickerTrigger');
    const panel = document.getElementById('repPickerPanel');
    const search = document.getElementById('repPickerSearch');
    const clearBtn = document.getElementById('repPickerClear');
    const listEl = document.getElementById('repPickerList');
    if (!trigger || !panel) return;

    trigger.addEventListener('click', evt => {
      evt.stopPropagation();
      if (meState.auth && meState.auth.allowRepOverride === false) return;
      if (meState.panelOpen) closeRepPanel();
      else openRepPanel();
    });

    document.addEventListener('click', evt => {
      if (!meState.panelOpen) return;
      const wrapper = document.getElementById('repPicker');
      if (wrapper && !wrapper.contains(evt.target)) closeRepPanel();
    });

    if (search) {
      search.addEventListener('input', evt => {
        meState.searchQuery = evt.target.value || '';
        renderRepPickerList();
      });
    }

    if (listEl) {
      listEl.addEventListener('click', evt => {
        const btn = evt.target.closest('[data-rep-username]');
        if (!btn) return;
        const username = btn.getAttribute('data-rep-username');
        const displayName = btn.getAttribute('data-rep-display') || username;
        setRepOverride({ username, displayName });
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => setRepOverride(null));
    }
  }

  function renderMyWork() {
    const section = document.getElementById('myWorkSection');
    if (!section) return;
    const heading = document.getElementById('myWorkHeading');
    const sub = document.getElementById('myWorkSub');
    const grid = document.getElementById('myWorkGrid');
    const recents = document.getElementById('myWorkRecents');
    const work = meState.work || null;
    const rep = work && work.rep ? work.rep : meState.rep;

    if (!rep) {
      if (heading) heading.textContent = 'Pick a rep to personalize.';
      if (sub) sub.textContent = 'Choose your name in the top bar (“Acting as”) to surface your accounts, prospects, open strategies, and overdue follow-ups.';
      if (grid) grid.hidden = true;
      if (recents) recents.hidden = true;
      return;
    }

    const displayName = rep.displayName || rep.username;
    if (heading) heading.textContent = `Acting as ${displayName}.`;
    if (sub) {
      const sourceLabel = rep.source === 'iis'
        ? `Detected from Windows login (${rep.username}). Use the top bar to override.`
        : rep.source === 'env'
          ? 'Loaded from FBBS_DEFAULT_REP. Use the top bar to override.'
          : 'Manual override active. Use the top bar to change or clear.';
      sub.textContent = sourceLabel;
    }
    if (grid) grid.hidden = false;

    const clients = (work && work.myClients) || { count: 0, recent: [] };
    const prospects = (work && work.myProspects) || { count: 0, recent: [] };
    const strategies = (work && work.myOpenStrategies) || { count: 0, recent: [], byStatus: {} };
    const overdue = (work && work.myOverdueFollowups) || { count: 0, items: [] };

    setMyWorkNum('clients', clients.count);
    setMyWorkList('clients', clients.recent, row => `
      <li>
        <button type="button" class="my-work-list-link" data-mywork-bank="${escapeHtml(row.bankId)}">
          <span class="my-work-list-name">${escapeHtml(row.displayName || 'Bank')}</span>
          <span class="my-work-list-meta">${escapeHtml([row.city, row.state].filter(Boolean).join(', '))}</span>
        </button>
      </li>
    `);

    setMyWorkNum('prospects', prospects.count);
    setMyWorkList('prospects', prospects.recent, row => `
      <li>
        <button type="button" class="my-work-list-link" data-mywork-bank="${escapeHtml(row.bankId)}">
          <span class="my-work-list-name">${escapeHtml(row.displayName || 'Bank')}</span>
          <span class="my-work-list-meta">${escapeHtml([row.city, row.state].filter(Boolean).join(', '))}</span>
        </button>
      </li>
    `);

    setMyWorkNum('strategies', strategies.count);
    const stratBy = strategies.byStatus || {};
    const stratParts = [];
    if (stratBy['Open']) stratParts.push(`<strong>${formatNumber(stratBy['Open'])}</strong> open`);
    if (stratBy['In Progress']) stratParts.push(`<strong>${formatNumber(stratBy['In Progress'])}</strong> in progress`);
    if (stratBy['Needs Billed']) stratParts.push(`<strong>${formatNumber(stratBy['Needs Billed'])}</strong> needs billed`);
    const stratDetail = document.querySelector('[data-mywork-detail="strategies"]');
    if (stratDetail) stratDetail.innerHTML = stratParts.join(' &middot; ');
    setMyWorkList('strategies', strategies.recent, row => `
      <li>
        <button type="button" class="my-work-list-link" data-mywork-strategy="${escapeHtml(row.id)}" data-mywork-bank="${escapeHtml(row.bankId)}">
          <span class="my-work-list-name">${escapeHtml(row.displayName || 'Bank')}</span>
          <span class="my-work-list-meta">${escapeHtml(row.requestType)} &middot; ${escapeHtml(row.status)}</span>
        </button>
      </li>
    `);

    setMyWorkNum('overdue', overdue.count);
    setMyWorkList('overdue', overdue.items, row => `
      <li>
        <button type="button" class="my-work-list-link" data-mywork-bank="${escapeHtml(row.bankId)}">
          <span class="my-work-list-name">${escapeHtml(row.displayName || 'Bank')}</span>
          <span class="my-work-list-meta">Due ${escapeHtml(row.nextActionDate || '')}</span>
        </button>
      </li>
    `);

    const recentItems = (work && work.recentlyTouched) || [];
    if (recents) {
      if (!recentItems.length) {
        recents.hidden = true;
      } else {
        recents.hidden = false;
        const list = document.getElementById('myWorkRecentList');
        if (list) {
          list.innerHTML = recentItems.map(item => {
            const meta = [item.city, item.state].filter(Boolean).join(', ');
            const when = item.at ? formatRelativeAt(item.at) : '';
            return `
              <li>
                <button type="button" class="my-work-recent-link" data-mywork-bank="${escapeHtml(item.bankId)}"${item.strategyId ? ` data-mywork-strategy="${escapeHtml(item.strategyId)}"` : ''}>
                  <span class="my-work-recent-kind">${escapeHtml(item.kind === 'strategy' ? 'Strategy' : 'Account')}</span>
                  <span class="my-work-recent-name">${escapeHtml(item.displayName || 'Bank')}</span>
                  <span class="my-work-recent-meta">${escapeHtml(item.detail || '')}${meta ? ` &middot; ${escapeHtml(meta)}` : ''}${when ? ` &middot; ${escapeHtml(when)}` : ''}</span>
                </button>
              </li>
            `;
          }).join('');
        }
      }
    }
  }

  function setMyWorkNum(key, value) {
    const el = document.querySelector(`[data-mywork-num="${key}"]`);
    if (el) el.textContent = formatNumber(Number(value || 0));
  }

  function setMyWorkList(key, items, renderItem) {
    const el = document.querySelector(`[data-mywork-list="${key}"]`);
    if (!el) return;
    if (!items || !items.length) {
      el.innerHTML = '<li class="my-work-list-empty">None.</li>';
      return;
    }
    el.innerHTML = items.map(renderItem).join('');
  }

  function formatRelativeAt(iso) {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms) || ms < 0) return iso.slice(0, 10);
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return iso.slice(0, 10);
  }

  function setupMyWorkClicks() {
    const section = document.getElementById('myWorkSection');
    if (!section) return;
    section.addEventListener('click', evt => {
      const btn = evt.target.closest('[data-mywork-bank]');
      if (!btn) return;
      const bankId = btn.getAttribute('data-mywork-bank');
      const strategyId = btn.getAttribute('data-mywork-strategy');
      if (strategyId) {
        goTo('strategies');
        return;
      }
      if (bankId) {
        goTo('banks');
        if (typeof loadBank === 'function') loadBank(bankId, { collapseResults: true });
      }
    });
  }

  // ============ Saved Views ============

  const SAVED_VIEW_COLUMN_LABELS = {
    displayName: 'Bank',
    legalName: 'Legal Name',
    city: 'City',
    state: 'State',
    certNumber: 'Cert',
    status: 'Status',
    owner: 'Owner',
    affiliate: 'Affiliate',
    requestType: 'Request',
    priority: 'Priority',
    assignedTo: 'Assigned',
    requestedBy: 'Requested by',
    invoiceContact: 'Invoice',
    nextActionDate: 'Next Action',
    summary: 'Summary',
    updatedAt: 'Updated',
    refType: 'Source',
    amount: 'Amount',
    enqueuedAt: 'Enqueued',
    billedAt: 'Billed'
  };

  function repScopeQuery() {
    return savedViewsState.scope === 'all' ? '?rep=all' : '';
  }

  async function loadSavedViewSummaries() {
    if (savedViewsState.loading) return;
    savedViewsState.loading = true;
    renderSavedViewsGrid();
    try {
      const res = await fetch('/api/bank-views' + repScopeQuery(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      savedViewsState.summaries = Array.isArray(data.views) ? data.views : [];
    } catch (e) {
      console.error('Failed to load saved views:', e);
      savedViewsState.summaries = [];
    } finally {
      savedViewsState.loading = false;
    }
    renderSavedViewsGrid();
  }

  async function openSavedView(viewId) {
    if (!viewId) return;
    savedViewsState.selectedId = viewId;
    savedViewsState.selectedResult = null;
    savedViewsState.loadingDetailFor = viewId;
    renderSavedViewDetail();
    try {
      const res = await fetch(`/api/bank-views/${encodeURIComponent(viewId)}` + repScopeQuery(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      savedViewsState.selectedResult = await res.json();
    } catch (e) {
      console.error('Failed to load view:', e);
      savedViewsState.selectedResult = { rows: [], columns: [], view: { label: viewId } };
    } finally {
      savedViewsState.loadingDetailFor = '';
    }
    renderSavedViewDetail();
  }

  function closeSavedView() {
    savedViewsState.selectedId = '';
    savedViewsState.selectedResult = null;
    renderSavedViewDetail();
  }

  function renderSavedViewsGrid() {
    const grid = document.getElementById('viewsGrid');
    if (!grid) return;
    if (savedViewsState.loading) {
      grid.innerHTML = '<p class="views-loading">Loading saved views&hellip;</p>';
      return;
    }
    if (!savedViewsState.summaries.length) {
      grid.innerHTML = '<p class="views-loading">No views available. Make sure the bank workbooks are imported.</p>';
      return;
    }
    grid.innerHTML = savedViewsState.summaries.map(view => {
      const countLabel = view.count === null || view.count === undefined
        ? (view.requiresRep ? 'Pick a rep' : '0')
        : formatNumber(view.count);
      const isSelected = savedViewsState.selectedId === view.id;
      return `
        <button type="button" class="views-card${isSelected ? ' is-selected' : ''}" data-views-card="${escapeHtml(view.id)}">
          <p class="views-card-label">${escapeHtml(view.label)}</p>
          <p class="views-card-count">${escapeHtml(countLabel)}</p>
          <p class="views-card-desc">${escapeHtml(view.description || '')}</p>
        </button>
      `;
    }).join('');
    grid.querySelectorAll('[data-views-card]').forEach(btn => {
      btn.addEventListener('click', () => openSavedView(btn.getAttribute('data-views-card')));
    });
  }

  function renderSavedViewDetail() {
    const detail = document.getElementById('viewsDetail');
    if (!detail) return;
    const id = savedViewsState.selectedId;
    if (!id) {
      detail.hidden = true;
      return;
    }
    detail.hidden = false;
    const result = savedViewsState.selectedResult;
    const view = (result && result.view) || savedViewsState.summaries.find(v => v.id === id) || { label: id };
    const kicker = document.getElementById('viewsDetailKicker');
    const label = document.getElementById('viewsDetailLabel');
    const sub = document.getElementById('viewsDetailSub');
    const csv = document.getElementById('viewsDetailCsv');
    const empty = document.getElementById('viewsDetailEmpty');
    const thead = document.querySelector('#viewsDetailTable thead');
    const tbody = document.querySelector('#viewsDetailTable tbody');
    if (kicker) kicker.textContent = savedViewsState.scope === 'all' ? 'Everyone · View' : 'Just me · View';
    if (label) label.textContent = view.label || id;
    if (sub) {
      const count = result ? result.count : null;
      sub.textContent = savedViewsState.loadingDetailFor === id
        ? 'Loading rows…'
        : (count != null ? `${formatNumber(count)} row${count === 1 ? '' : 's'}` : '');
    }
    if (csv) csv.setAttribute('href', `/api/bank-views/${encodeURIComponent(id)}.csv` + repScopeQuery());
    if (!result) {
      if (thead) thead.innerHTML = '';
      if (tbody) tbody.innerHTML = '';
      if (empty) empty.hidden = true;
      return;
    }
    const cols = result.columns || [];
    if (thead) {
      thead.innerHTML = `<tr>${cols.map(c => `<th>${escapeHtml(SAVED_VIEW_COLUMN_LABELS[c] || c)}</th>`).join('')}</tr>`;
    }
    if (!result.rows || !result.rows.length) {
      if (tbody) tbody.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    if (tbody) {
      tbody.innerHTML = result.rows.slice(0, 500).map(row => {
        const bankId = row.bankId || '';
        const rowOpen = bankId ? ` data-views-row-bank="${escapeHtml(bankId)}"` : '';
        return `<tr${rowOpen}>${cols.map(c => `<td>${escapeHtml(String(row[c] == null ? '' : row[c]))}</td>`).join('')}</tr>`;
      }).join('');
      tbody.querySelectorAll('[data-views-row-bank]').forEach(tr => {
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => {
          const bankId = tr.getAttribute('data-views-row-bank');
          if (!bankId) return;
          goTo('banks');
          if (typeof loadBank === 'function') loadBank(bankId, { collapseResults: true });
        });
      });
    }
  }

  function setupSavedViews() {
    const page = document.getElementById('p-views');
    if (!page) return;
    page.querySelectorAll('[data-views-scope]').forEach(btn => {
      btn.addEventListener('click', () => {
        const next = btn.getAttribute('data-views-scope');
        if (savedViewsState.scope === next) return;
        savedViewsState.scope = next;
        page.querySelectorAll('[data-views-scope]').forEach(b => {
          b.classList.toggle('is-active', b.getAttribute('data-views-scope') === next);
        });
        savedViewsState.selectedId = '';
        savedViewsState.selectedResult = null;
        renderSavedViewDetail();
        loadSavedViewSummaries();
      });
    });
    const closeBtn = document.getElementById('viewsDetailClose');
    if (closeBtn) closeBtn.addEventListener('click', closeSavedView);
  }

  function setHomeTilePulse(numId, labelId, footId, opts) {
    const numEl = document.getElementById(numId);
    const labelEl = document.getElementById(labelId);
    const footEl = document.getElementById(footId);
    if (numEl) numEl.textContent = opts.num != null ? opts.num : '—';
    if (labelEl) labelEl.textContent = opts.label || '';
    if (footEl) {
      footEl.innerHTML = opts.footHtml || (opts.foot ? escapeHtml(opts.foot) : '');
      footEl.classList.toggle('is-warn', !!opts.warn);
      footEl.classList.toggle('is-empty', !!opts.empty);
    }
  }

  function renderHomeTileAccounts() {
    const status = bankDataStatus || {};
    const accountInfo = status.accountStatuses || {};
    const bankCount = status.available
      ? (status.bankCount || (status.metadata && status.metadata.bankCount))
      : null;

    if (!status.available) {
      setHomeTilePulse('homeTileAccountsNum', 'homeTileAccountsLabel', 'homeTileAccountsFoot', {
        num: '—', label: 'Banks',
        foot: 'Upload the SNL call report workbook to enable.', empty: true
      });
      return;
    }

    const counts = (accountInfo.metadata && accountInfo.metadata.statuses) || {};
    const clients = Number(counts.Client || 0);
    const prospects = Number(counts.Prospect || 0);
    const watchlist = Number(counts.Watchlist || 0);
    const open = Number(counts.Open || 0);
    const tagged = clients + prospects + watchlist + open;

    const parts = [];
    if (clients) parts.push(`<strong>${formatNumber(clients)}</strong> clients`);
    if (prospects) parts.push(`<strong>${formatNumber(prospects)}</strong> prospects`);
    if (watchlist) parts.push(`<strong>${formatNumber(watchlist)}</strong> watchlist`);
    if (!parts.length && open) parts.push(`<strong>${formatNumber(open)}</strong> tagged`);
    if (!parts.length && accountInfo.available) parts.push(`<strong>${formatNumber(accountInfo.statusCount || 0)}</strong> tagged`);

    const period = (status.metadata && status.metadata.latestPeriod) || null;
    const footPieces = parts.length ? parts.join('<span class="home-tile-foot-divider">·</span>') : '';
    const periodSuffix = period ? `<span class="home-tile-foot-divider">·</span>${escapeHtml(period)}` : '';
    const taggedSuffix = !parts.length && tagged === 0
      ? 'No accounts tagged yet'
      : footPieces + periodSuffix;

    setHomeTilePulse('homeTileAccountsNum', 'homeTileAccountsLabel', 'homeTileAccountsFoot', {
      num: formatNumber(bankCount),
      label: 'Banks',
      footHtml: taggedSuffix
    });
  }

  function renderHomeTileMarkets() {
    const list = document.getElementById('homeTileMarketsBreakdown');
    if (!list) return;

    const items = [
      { count: (marketData.treasuryNotes || []).length, label: 'Treasuries', page: 'treasury-explorer' },
      { count: (marketData.cds || []).length, label: 'CDs', page: 'explorer' },
      { count: (marketData.munis || []).length, label: 'Munis', page: 'muni-explorer' },
      { count: (marketData.agencies || []).length, label: 'Agencies', page: 'agencies' },
      { count: (marketData.corporates || []).length, label: 'Corporates', page: 'corporates' }
    ];

    const total = items.reduce((sum, item) => sum + item.count, 0);
    if (!total) {
      list.innerHTML = '<li class="home-tile-breakdown-empty">No offering data in the current package.</li>';
      return;
    }

    list.innerHTML = items.map(item => `
      <li>
        <span class="home-tile-breakdown-num">${formatNumber(item.count)}</span>
        <span class="home-tile-breakdown-label">${escapeHtml(item.label)}</span>
        <button type="button" class="home-tile-breakdown-btn" data-goto="${escapeHtml(item.page)}" aria-label="Open ${escapeHtml(item.label)} explorer">
          Open <span aria-hidden="true">&rarr;</span>
        </button>
      </li>
    `).join('');
  }

  function renderHomeTileDaily() {
    const dateEl = document.getElementById('homeTileDailyDate');
    if (!dateEl) return;
    const pkg = currentPackage || {};
    const filled = packageUploadedCount(pkg);
    const dateLabel = pkg.date ? formatShortDate(pkg.date) : null;
    dateEl.textContent = filled === 0 ? '—' : (dateLabel || 'Today');
  }

  function renderHomeTileStrategies() {
    const footEl = document.getElementById('homeTileStrategiesFoot');
    if (!footEl) return;
    const counts = strategyNotifications.counts || {};
    const open = Number(counts.Open || 0);
    const inProgress = Number(counts['In Progress'] || 0);
    const needsBilled = Number(counts['Needs Billed'] || 0);

    const parts = [];
    if (open) parts.push(`<strong>${formatNumber(open)}</strong> open`);
    if (inProgress) parts.push(`<strong>${formatNumber(inProgress)}</strong> in progress`);
    if (needsBilled) parts.push(`<strong>${formatNumber(needsBilled)}</strong> needs billed`);

    footEl.classList.toggle('is-warn', needsBilled > 0);
    footEl.classList.toggle('is-empty', parts.length === 0);
    footEl.innerHTML = parts.length
      ? parts.join('<span class="home-tile-foot-divider">·</span>')
      : '';
  }

  function renderHomeStatusPill(pkg, filled) {
    const pill = document.getElementById('homeStatusPill');
    if (!pill) return;
    const textEl = pill.querySelector('.hero-status-text');
    if (!textEl) return;
    const dateLabel = pkg && pkg.date ? formatShortDate(pkg.date) : null;
    let state = 'empty';
    let text = 'Awaiting today’s package';
    if (filled === TOTAL_SLOTS) {
      state = 'full';
      text = dateLabel ? `Published · ${dateLabel} · ${TOTAL_SLOTS} of ${TOTAL_SLOTS}` : `Published · ${TOTAL_SLOTS} of ${TOTAL_SLOTS}`;
    } else if (filled > 0) {
      state = 'partial';
      text = dateLabel
        ? `In progress · ${dateLabel} · ${filled} of ${TOTAL_SLOTS}`
        : `In progress · ${filled} of ${TOTAL_SLOTS}`;
    }
    pill.dataset.state = state;
    textEl.textContent = text;
    pill.hidden = false;
  }

  function renderHomeRecents() {
    const section = document.getElementById('homeRecentsSection');
    const grid = document.getElementById('homeRecentsGrid');
    if (!section || !grid) return;
    const recents = (typeof loadRecentBanks === 'function' ? loadRecentBanks() : []).slice(0, 6);
    if (!recents.length) {
      section.hidden = true;
      grid.innerHTML = '';
      return;
    }
    grid.innerHTML = recents.map(row => {
      const name = escapeHtml(bankDisplayName(row));
      const cityState = [row.city, row.state].filter(Boolean).join(', ');
      const meta = escapeHtml(cityState || row.primaryRegulator || '');
      const status = escapeHtml(bankAccountStatusLabel(row.accountStatus));
      return `
        <button type="button" class="home-recent-card" data-home-recent-id="${escapeHtml(String(row.id))}">
          ${status ? `<span class="home-recent-status">${status}</span>` : ''}
          <span class="home-recent-name">${name}</span>
          <span class="home-recent-meta">${meta}</span>
        </button>
      `;
    }).join('');
    section.hidden = false;
    grid.querySelectorAll('[data-home-recent-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-home-recent-id');
        if (!id) return;
        goTo('banks');
        loadBank(id, { collapseResults: true });
      });
    });
  }

  function normalizeSearchText(parts) {
    const values = [];
    const add = value => {
      if (value == null || value === '') return;
      if (Array.isArray(value)) {
        value.forEach(add);
        return;
      }
      if (typeof value === 'object') {
        Object.values(value).forEach(add);
        return;
      }
      const raw = String(value).trim().toLowerCase();
      if (!raw) return;
      const spaced = raw.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
      values.push(raw);
      if (spaced && spaced !== raw) values.push(spaced);
      if (spaced && spaced.includes(' ')) values.push(spaced.replace(/\s+/g, ''));
    };
    parts.forEach(add);
    return values.join(' ');
  }

  const STATE_SEARCH_ALIASES = {
    AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california',
    CO: 'colorado', CT: 'connecticut', DE: 'delaware', DC: 'district of columbia washington dc',
    FL: 'florida', GA: 'georgia', HI: 'hawaii', ID: 'idaho', IL: 'illinois',
    IN: 'indiana', IA: 'iowa', KS: 'kansas', KY: 'kentucky', LA: 'louisiana',
    ME: 'maine', MD: 'maryland', MA: 'massachusetts', MI: 'michigan', MN: 'minnesota',
    MS: 'mississippi', MO: 'missouri', MT: 'montana', NE: 'nebraska', NV: 'nevada',
    NH: 'new hampshire', NJ: 'new jersey', NM: 'new mexico', NY: 'new york',
    NC: 'north carolina', ND: 'north dakota', OH: 'ohio', OK: 'oklahoma',
    OR: 'oregon', PA: 'pennsylvania', RI: 'rhode island', SC: 'south carolina',
    SD: 'south dakota', TN: 'tennessee', TX: 'texas', UT: 'utah', VT: 'vermont',
    VA: 'virginia', WA: 'washington', WV: 'west virginia', WI: 'wisconsin',
    WY: 'wyoming', PR: 'puerto rico', GU: 'guam', VI: 'virgin islands'
  };

  function stateSearchAliases(value) {
    const code = String(value || '').trim().toUpperCase();
    if (!code) return [];
    const name = STATE_SEARCH_ALIASES[code];
    return name ? [code, name] : [code];
  }

  function creditSearchAliases(value) {
    const tier = String(value || '').trim();
    if (!tier) return [];
    return [tier, `${tier} rated`, `${tier}-rated`, `${tier} rating`];
  }

  function searchTermsFromQuery(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  function buildSearchRows() {
    const rows = [];
    (marketData.cds || []).forEach(o => rows.push({
      type: 'CD',
      title: o.name,
      subtitle: `${formatPercentTile(o.rate, 2)} · ${o.term} · ${formatShortDate(o.maturity)}`,
      meta: o.cusip,
      page: 'explorer',
      searchText: normalizeSearchText([
        o,
        stateSearchAliases(o.issuerState),
        'cd certificate deposit brokered cd security'
      ])
    }));
    (marketData.munis || []).forEach(o => rows.push({
      type: 'Muni',
      title: o.issuerName,
      subtitle: `${o.section || 'Muni'} · ${o.issuerState || ''} · ${formatPercentTile(o.ytw, 3)}`,
      meta: o.cusip,
      page: 'muni-explorer',
      searchText: normalizeSearchText([
        o,
        stateSearchAliases(o.issuerState),
        'muni municipal bond security tax exempt taxable bq'
      ])
    }));
    (marketData.agencies || []).forEach(o => rows.push({
      type: 'Agency',
      title: `${o.ticker || 'Agency'} ${o.cusip || ''}`,
      subtitle: `${o.structure || ''} · ${formatPercentTile(o.ytm, 3)} · ${formatShortDate(o.maturity)}`,
      meta: o.callType || o.benchmark || '',
      page: 'agencies',
      searchText: normalizeSearchText([
        o,
        'agency agencies government sponsored gse bond security bullet callable'
      ])
    }));
    (marketData.corporates || []).forEach(o => rows.push({
      type: 'Corporate',
      title: o.issuerName,
      subtitle: `${o.ticker || ''} · ${o.creditTier || ''} · ${formatPercentTile(o.ytm, 3)}`,
      meta: o.cusip,
      page: 'corporates',
      searchText: normalizeSearchText([
        o,
        creditSearchAliases(o.creditTier),
        o.investmentGrade ? 'investment grade ig' : 'high yield hy',
        'corporate corp bond security'
      ])
    }));
    return rows;
  }

  function interleaveSearchMatches(matches, limit = 24) {
    const typeOrder = ['CD', 'Muni', 'Agency', 'Corporate'];
    const groups = new Map(typeOrder.map(type => [type, []]));
    matches.forEach(row => {
      if (!groups.has(row.type)) groups.set(row.type, []);
      groups.get(row.type).push(row);
    });

    const ordered = [];
    while (ordered.length < limit) {
      let added = false;
      for (const type of typeOrder) {
        const next = groups.get(type).shift();
        if (!next) continue;
        ordered.push(next);
        added = true;
        if (ordered.length >= limit) break;
      }
      if (!added) break;
    }
    return ordered;
  }

  function renderGlobalSearch() {
    const input = document.getElementById('globalSearchInput');
    const results = document.getElementById('globalSearchResults');
    if (!input || !results) return;

    const terms = searchTermsFromQuery(input.value);
    if (!terms.length) {
      results.innerHTML = '<div class="global-empty">Start typing to search CDs, munis, agencies, and corporates.</div>';
      return;
    }

    const matches = interleaveSearchMatches(
      buildSearchRows().filter(row => terms.every(term => row.searchText.includes(term)))
    );

    if (!matches.length) {
      results.innerHTML = '<div class="global-empty">No matching offerings found.</div>';
      return;
    }

    results.innerHTML = matches.map(row => `
      <button class="global-result" type="button" data-goto="${row.page}">
        <span class="global-type">${escapeHtml(row.type)}</span>
        <span class="global-title">${escapeHtml(row.title || '—')}</span>
        <span class="global-subtitle">${escapeHtml(row.subtitle || '')}</span>
        <span class="global-meta">${escapeHtml(row.meta || '')}</span>
      </button>
    `).join('');
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ============ Document viewers ============

  function renderViewer(slot) {
    const frame = document.getElementById(slot === 'dashboard' ? 'dashFrame' : slot + 'Frame');
    const sub = document.getElementById(slot === 'dashboard' ? 'dashSub' : slot + 'Sub');
    const btn = document.getElementById(slot === 'dashboard' ? 'dashOpenBtn' : slot + 'DownloadBtn');
    const file = currentPackage && currentPackage[slot];
    const meta = DOC_TYPES[slot];

    if (!frame || !sub || !btn) return;

    if (file) {
      const src = '/current/' + encodeURIComponent(file);
      const isExcel = /\.(xlsx|xlsm|xls)$/i.test(file);
      // The Sales Dashboard is user-uploaded HTML. Sandbox it with
      // allow-scripts only (no allow-same-origin) so its JavaScript can still
      // run (Chart.js, inline handlers) but the iframe gets an opaque origin
      // and cannot read parent state or call our same-origin APIs.
      const sandboxAttr = slot === 'dashboard' ? ' sandbox="allow-scripts"' : '';
      if (isExcel) {
        const explorerPage = slot === 'cdoffers' ? 'explorer' : (meta.viewer || 'explorer');
        const excelCopy = slot === 'cdoffers'
          ? 'Use the Explorer page for searchable offering data, or download the source workbook.'
          : 'Download the source workbook to review the uploaded sheet.';
        const excelButton = slot === 'cdoffers'
          ? `<button class="doc-btn" data-goto="${explorerPage}">Open Explorer</button>`
          : '';
        frame.innerHTML = `
          <div class="viewer-empty">
            <div class="ff-kicker">Excel Source Loaded</div>
            <h2>${meta.label} workbook uploaded</h2>
            <p>${excelCopy}</p>
            ${excelButton}
          </div>`;
      } else {
        const loadingId = `viewerLoading-${slot}`;
        frame.innerHTML = `
          <div class="viewer-loading" id="${loadingId}">
            <div class="loading-spinner" aria-hidden="true"></div>
            <span>Loading ${escapeHtml(meta.label)}&hellip;</span>
          </div>
          <iframe src="${src}" title="${meta.label}"${sandboxAttr}></iframe>`;
        const iframe = frame.querySelector('iframe');
        const loading = document.getElementById(loadingId);
        if (iframe && loading) {
          iframe.addEventListener('load', () => {
            loading.hidden = true;
          });
        }
      }
      sub.textContent = `${file} · Published ${formatTime(currentPackage.publishedAt)}`;
      if (slot === 'dashboard') {
        btn.onclick = () => window.open(src, '_blank', 'noopener');
      } else {
        btn.onclick = () => { window.location.href = src + '?download=1'; };
      }
      if (slot !== 'dashboard') btn.textContent = isExcel ? 'Download Excel ↓' : 'Download PDF ↓';
      btn.style.display = '';
    } else {
      frame.innerHTML = `
        <div class="viewer-empty">
          <div class="ff-kicker">No Document Loaded</div>
          <h2>No ${meta.label} uploaded yet</h2>
          <p>Go to the Upload page to publish today's ${meta.label}.</p>
          <button class="doc-btn" data-goto="upload">Go to Upload</button>
        </div>`;
      sub.textContent = `No ${meta.label} uploaded`;
      btn.style.display = 'none';
    }
  }

  // ============ Economic Update Tool ============

  async function loadEconomicUpdate() {
    const tool = document.getElementById('economicTool');
    if (!tool) return;
    if (!currentPackage || !currentPackage.econ) {
      economicUpdateData = null;
      renderEconomicUpdate();
      return;
    }
    try {
      const res = await fetch('/api/economic-update', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      economicUpdateData = await res.json();
    } catch (e) {
      console.error('Failed to load economic update:', e);
      economicUpdateData = null;
    }
    renderEconomicUpdate();
  }

  function formatMarketValue(row) {
    if (!row) return '—';
    const value = row.value != null ? row.value : row.priorClose;
    if (value == null || isNaN(value)) return row.status || '—';
    return row.isPercent ? formatPercentTile(value, 2) : formatNumber(value);
  }

  function formatMarketChange(value, digits = 3) {
    if (value == null || isNaN(value)) return '—';
    const sign = Number(value) > 0 ? '+' : '';
    return `${sign}${Number(value).toFixed(digits)}`;
  }

  function changeClass(value) {
    if (value == null || isNaN(value)) return '';
    return Number(value) > 0 ? 'positive' : Number(value) < 0 ? 'negative' : 'flat';
  }

  function economicRowHtml(row) {
    return `
      <div class="market-data-row">
        <span>${escapeHtml(row.label || row.event || row.tenor || 'Item')}</span>
        <strong>${escapeHtml(row.event ? (row.dateTime || 'Watch') : formatMarketValue(row))}</strong>
        <em class="${changeClass(row.change)}">${escapeHtml(row.change != null ? formatMarketChange(row.change, row.isPercent ? 3 : 2) : row.status || '')}</em>
      </div>
    `;
  }

  function calendarDateParts(dateTime) {
    const text = String(dateTime || '').trim();
    const match = text.match(/^(\d{2}\/\d{2}\/\d{2})\s+(.+)$/);
    if (!match) return { date: 'Watch', time: text || 'Time pending' };
    return { date: match[1], time: match[2] };
  }

  function economicCalendarHtml(items) {
    if (!items.length) {
      return '<div class="market-empty small">No economic calendar items extracted.</div>';
    }
    return `
      <div class="calendar-event-list">
        ${items.map(item => {
          const parts = calendarDateParts(item.dateTime);
          return `
            <article class="calendar-event-card">
              <div class="calendar-event-time">
                <span>${escapeHtml(parts.date)}</span>
                <strong>${escapeHtml(parts.time)}</strong>
              </div>
              <div class="calendar-event-copy">
                <h4>${escapeHtml(item.event || 'Economic release')}</h4>
                <p>From the uploaded daily Economic Update calendar.</p>
              </div>
            </article>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderEconomicUpdate() {
    const summary = document.getElementById('econMarketSummary');
    const sub = document.getElementById('econToolSub');
    const dateBadge = document.getElementById('econToolDate');
    const curve = document.getElementById('econCurveChart');
    const slopeEl = document.getElementById('econCurveSlope');
    const cues = document.getElementById('econSalesCues');
    const cueCount = document.getElementById('econCueCount');
    if (!summary || !sub || !dateBadge || !curve || !slopeEl || !cues || !cueCount) return;

    const data = economicUpdateData;
    if (!data) {
      sub.textContent = currentPackage && currentPackage.econ
        ? 'Market data could not be extracted yet. The PDF remains available below.'
        : 'Upload the daily Economic Update PDF to activate this tool.';
      dateBadge.textContent = 'No data';
      summary.innerHTML = `
        <div class="market-empty">
          <strong>No interactive market data loaded</strong>
          <p>This section uses the uploaded daily Economic Update PDF.</p>
        </div>`;
      curve.innerHTML = '';
      slopeEl.textContent = '2s/10s —';
      cues.innerHTML = '';
      cueCount.textContent = '—';
      renderEconomicDetail();
      return;
    }

    const treasuries = data.treasuries || [];
    const marketRates = data.marketRates || [];
    const marketRows = data.marketData || [];
    const two = treasuries.find(row => row.tenor === '2YR');
    const ten = treasuries.find(row => row.tenor === '10YR');
    const sofr = marketRates.find(row => row.label === 'SOFR');
    const prime = marketRates.find(row => row.label === 'Prime Rate');
    const vix = marketRows.find(row => row.label === 'VIX');
    const crude = marketRows.find(row => row.label === 'CRUDE FUTURE');
    const spx = marketRows.find(row => row.label === 'SPX') || marketRows.find(row => row.label === 'S&P 500');

    sub.textContent = `${data.sourceFile || currentPackage.econ || 'Economic Update'} · Extracted ${formatFullTimestamp(data.extractedAt)}`;
    dateBadge.textContent = data.asOfDate ? formatShortDate(data.asOfDate) : 'Current';
    slopeEl.textContent = two && ten ? `2s/10s ${(ten.yield - two.yield).toFixed(3)}%` : '2s/10s —';

    summary.innerHTML = [
      { label: '2Y Treasury', value: two ? formatPercentTile(two.yield, 3) : '—', change: two ? formatMarketChange(two.dailyChange, 3) : '—' },
      { label: '10Y Treasury', value: ten ? formatPercentTile(ten.yield, 3) : '—', change: ten ? formatMarketChange(ten.dailyChange, 3) : '—' },
      { label: 'SOFR', value: formatMarketValue(sofr), change: sofr ? formatMarketChange(sofr.change, 3) : '—' },
      { label: 'Prime Rate', value: formatMarketValue(prime), change: prime ? formatMarketChange(prime.change, 3) : '—' },
      { label: 'SPX', value: formatMarketValue(spx), change: spx ? formatMarketChange(spx.change, 2) : '—' },
      { label: 'VIX', value: formatMarketValue(vix), change: vix ? formatMarketChange(vix.change, 2) : '—' },
      { label: 'Crude Future', value: formatMarketValue(crude), change: crude ? formatMarketChange(crude.change, 2) : '—' }
    ].map(item => `
      <div class="market-summary-card">
        <span>${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(item.value)}</strong>
        <em>${escapeHtml(item.change)}</em>
      </div>
    `).join('');

    renderCurveChart(treasuries);
    const cueRows = data.salesCues || [];
    cueCount.textContent = `${cueRows.length} cues`;
    cues.innerHTML = cueRows.length ? cueRows.map(cue => `
      <div class="sales-cue">
        <strong>${escapeHtml(cue.title)}</strong>
        <p>${escapeHtml(cue.body)}</p>
      </div>
    `).join('') : '<div class="market-empty small">No sales cues extracted.</div>';
    renderEconomicDetail();
  }

  function renderCurveChart(treasuries, targetId = 'econCurveChart') {
    const curve = document.getElementById(targetId);
    if (!curve) return;
    const rows = (treasuries || [])
      .map(row => ({ ...row, yield: Number(row && row.yield) }))
      .filter(row => Number.isFinite(row.yield));
    if (!rows.length) {
      curve.innerHTML = '<div class="market-empty small">Treasury curve unavailable.</div>';
      return;
    }
    const yields = rows.map(row => row.yield);
    const min = Math.min.apply(null, yields);
    const max = Math.max.apply(null, yields);
    const range = Math.max(max - min, 0.01);
    curve.innerHTML = rows.map(row => {
      const height = 18 + ((row.yield - min) / range) * 72;
      const label = row.label || row.tenor || 'Treasury';
      const tooltip = `${label} · ${formatTooltipYield(row.yield)}`;
      return `
        <div class="curve-bar" data-chart-tooltip="${escapeHtml(tooltip)}" aria-label="${escapeHtml(tooltip)}">
          <span style="height:${height.toFixed(1)}%"></span>
          <strong>${escapeHtml(formatPercentTile(row.yield, 2))}</strong>
          <em>${escapeHtml(label)}</em>
        </div>
      `;
    }).join('');
  }

  function renderEconomicDetail() {
    const detail = document.getElementById('econMarketDetail');
    if (!detail) return;
    const data = economicUpdateData;
    if (!data) {
      detail.innerHTML = '<div class="market-empty small">Choose a section after the Economic Update has been uploaded.</div>';
      return;
    }

    if (selectedMarketSection === 'risk') {
      detail.innerHTML = `<div class="market-data-list">${(data.marketData || []).map(economicRowHtml).join('')}</div>`;
      return;
    }
    if (selectedMarketSection === 'headlines') {
      const items = data.headlines || [];
      detail.innerHTML = items.length
        ? `<div class="headline-list">${items.map(item => `<p>${escapeHtml(item)}</p>`).join('')}</div>`
        : '<div class="market-empty small">No headlines extracted from the PDF.</div>';
      return;
    }
    if (selectedMarketSection === 'calendar') {
      const items = data.releases || [];
      detail.innerHTML = economicCalendarHtml(items);
      return;
    }

    const rows = [
      ...(data.marketRates || []),
      ...(data.bondIndices || [])
    ];
    detail.innerHTML = rows.length
      ? `<div class="market-data-list">${rows.map(economicRowHtml).join('')}</div>`
      : '<div class="market-empty small">No market rates extracted.</div>';
  }

  function setupEconomicMarketTool() {
    document.querySelectorAll('[data-market-section]').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedMarketSection = btn.dataset.marketSection || 'rates';
        document.querySelectorAll('[data-market-section]').forEach(item => {
          item.classList.toggle('active', item === btn);
        });
        renderEconomicDetail();
      });
    });
  }

  // ============ Daily Intelligence ============

  async function loadDailyIntelligence() {
    const picksEl = document.getElementById('dailyIntelPicks');
    const curveEl = document.getElementById('dailyIntelCurveChart');
    const summaryEl = document.getElementById('dailyIntelSummary');
    if (picksEl) picksEl.innerHTML = '<div class="market-empty">Building rule-based picks&hellip;</div>';
    if (curveEl) curveEl.innerHTML = '<div class="market-loading"><div class="loading-spinner" aria-hidden="true"></div><span>Loading Treasury curve&hellip;</span></div>';
    if (summaryEl) summaryEl.innerHTML = marketSkeletonCards(4);
    try {
      const res = await fetch('/api/daily-intelligence', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      dailyIntelData = await res.json();
    } catch (e) {
      console.error('Failed to load daily intelligence:', e);
      dailyIntelData = null;
    }
    renderDailyIntelligence();
  }

  function dailyMarketRow(rows, labels) {
    return (rows || []).find(row => labels.includes(row.label));
  }

  function dailyTreasuryRow(treasuries, tenor) {
    return (treasuries || []).find(row => row.tenor === tenor);
  }

  function renderDailyCurveChart(treasuries) {
    renderCurveChart(treasuries, 'dailyIntelCurveChart');
  }

  function marketSkeletonCards(count) {
    return Array.from({ length: count }, () => '<div class="market-summary-card skeleton-card"></div>').join('');
  }

  function dailySummaryCard(label, value, detail, tone = '') {
    return `
      <div class="market-summary-card">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value || '—')}</strong>
        <em class="${escapeHtml(tone)}">${escapeHtml(detail || '')}</em>
      </div>
    `;
  }

  function renderDailyPickCard(pick) {
    const audience = (pick.audience || []).join(' / ');
    const metrics = pick.metrics && pick.metrics.tey296 != null
      ? `<div class="daily-pick-metrics">
          <span>TEY 21% ${escapeHtml(formatPercentTile(pick.metrics.tey21, 3))}</span>
          <span>TEY 29.6% ${escapeHtml(formatPercentTile(pick.metrics.tey296, 3))}</span>
        </div>`
      : '';
    return `
      <article class="daily-pick-card">
        <div class="daily-pick-head">
          <span>${escapeHtml(pick.type || 'Pick')}</span>
          <em>${escapeHtml(audience || pick.label || '')}</em>
        </div>
        <h4>${escapeHtml(pick.title || 'Untitled pick')}</h4>
        <div class="daily-pick-value">${escapeHtml(pick.value || 'Review')}</div>
        <p>${escapeHtml(pick.detail || '')}</p>
        ${metrics}
        <div class="daily-pick-foot">
          ${pick.cusip ? `<code>${escapeHtml(pick.cusip)}</code>` : '<span></span>'}
          <button type="button" class="small-btn" data-goto="${escapeHtml(pick.page || 'home')}">Open</button>
        </div>
        <div class="daily-pick-reason">${escapeHtml(pick.reason || '')}</div>
      </article>
    `;
  }

  function renderDailyIntelligence() {
    const sub = document.getElementById('dailyIntelSub');
    const stat = document.getElementById('dailyIntelStat');
    const kicker = document.getElementById('dailyIntelKicker');
    const status = document.getElementById('dailyIntelStatus');
    const summary = document.getElementById('dailyIntelSummary');
    const slopeEl = document.getElementById('dailyIntelCurveSlope');
    const cues = document.getElementById('dailyIntelSalesCues');
    const cueCount = document.getElementById('dailyIntelCueCount');
    const picksEl = document.getElementById('dailyIntelPicks');
    const gapsEl = document.getElementById('dailyIntelGaps');
    if (!sub || !stat || !kicker || !status || !summary || !slopeEl || !cues || !cueCount || !picksEl || !gapsEl) return;

    const data = dailyIntelData;
    if (!data) {
      sub.textContent = 'Daily intelligence could not be loaded.';
      stat.textContent = '0';
      kicker.textContent = 'Error';
      status.innerHTML = '<div class="daily-intel-alert">Could not load the daily intelligence endpoint.</div>';
      summary.innerHTML = '';
      picksEl.innerHTML = '<div class="market-empty">No rule-based picks available.</div>';
      gapsEl.innerHTML = '';
      renderDailyCurveChart([]);
      return;
    }

    const market = data.market || {};
    const treasuries = (market.treasuries && market.treasuries.length)
      ? market.treasuries
      : (economicUpdateData && Array.isArray(economicUpdateData.treasuries) ? economicUpdateData.treasuries : []);
    const marketRows = market.marketData || [];
    const marketRates = market.marketRates || [];
    const two = dailyTreasuryRow(treasuries, '2YR');
    const five = dailyTreasuryRow(treasuries, '5YR');
    const ten = dailyTreasuryRow(treasuries, '10YR');
    const thirty = dailyTreasuryRow(treasuries, '30YR');
    const vix = dailyMarketRow(marketRows, ['VIX']);
    const spx = dailyMarketRow(marketRows, ['SPX', 'S&P 500']);
    const crude = dailyMarketRow(marketRows, ['CRUDE FUTURE', 'Crude Oil']);
    const sofr = dailyMarketRow(marketRates, ['SOFR']);
    const counts = data.counts || {};
    const picks = data.picks || [];
    const warnings = data.warnings || [];
    const gaps = data.gaps || [];

    stat.textContent = formatNumber(picks.length);
    sub.textContent = data.asOfDate
      ? `Auto-generated from the ${formatShortDate(data.asOfDate)} uploaded package.`
      : 'Auto-generated from the current uploaded package.';
    kicker.textContent = data.publishedAt ? `Published ${formatFullTimestamp(data.publishedAt)}` : 'Current package';
    slopeEl.textContent = two && ten ? `2s/10s ${(ten.yield - two.yield).toFixed(3)}%` : '2s/10s —';

    status.innerHTML = `
      <div class="daily-intel-pill"><strong>${escapeHtml(formatNumber(counts.treasuries || 0))}</strong> Treasuries</div>
      <div class="daily-intel-pill"><strong>${escapeHtml(formatNumber(counts.cds || 0))}</strong> CDs</div>
      <div class="daily-intel-pill"><strong>${escapeHtml(formatNumber(counts.munis || 0))}</strong> Munis</div>
      <div class="daily-intel-pill"><strong>${escapeHtml(formatNumber(counts.agencies || 0))}</strong> Agencies</div>
      <div class="daily-intel-pill"><strong>${escapeHtml(formatNumber(counts.corporates || 0))}</strong> Corporates</div>
      <div class="daily-intel-pill ${warnings.length ? 'warn' : ''}"><strong>${escapeHtml(formatNumber(warnings.length))}</strong> Warnings</div>
    `;

    summary.innerHTML = [
      dailySummaryCard('2Y Treasury', two ? formatPercentTile(two.yield, 3) : '—', two ? formatMarketChange(two.dailyChange, 3) : '—', changeClass(two && two.dailyChange)),
      dailySummaryCard('5Y Treasury', five ? formatPercentTile(five.yield, 3) : '—', five ? formatMarketChange(five.dailyChange, 3) : '—', changeClass(five && five.dailyChange)),
      dailySummaryCard('10Y Treasury', ten ? formatPercentTile(ten.yield, 3) : '—', ten ? formatMarketChange(ten.dailyChange, 3) : '—', changeClass(ten && ten.dailyChange)),
      dailySummaryCard('30Y Treasury', thirty ? formatPercentTile(thirty.yield, 3) : '—', thirty ? formatMarketChange(thirty.dailyChange, 3) : '—', changeClass(thirty && thirty.dailyChange)),
      dailySummaryCard('SOFR', formatMarketValue(sofr), sofr ? formatMarketChange(sofr.change, 3) : '—', changeClass(sofr && sofr.change)),
      dailySummaryCard('S&P 500', formatMarketValue(spx), spx ? formatMarketChange(spx.change, 2) : '—', changeClass(spx && spx.change)),
      dailySummaryCard('VIX', formatMarketValue(vix), vix ? formatMarketChange(vix.change, 2) : '—', changeClass(vix && vix.change)),
      dailySummaryCard('Crude', formatMarketValue(crude), crude ? formatMarketChange(crude.change, 2) : '—', changeClass(crude && crude.change))
    ].join('');

    renderDailyCurveChart(treasuries);
    const cueRows = market.salesCues || [];
    cueCount.textContent = `${cueRows.length} cues`;
    cues.innerHTML = cueRows.length ? cueRows.map(cue => `
      <div class="sales-cue">
        <strong>${escapeHtml(cue.title || 'Sales cue')}</strong>
        <p>${escapeHtml(cue.body || '')}</p>
      </div>
    `).join('') : '<div class="market-empty small">No sales cues extracted.</div>';

    picksEl.innerHTML = picks.length
      ? picks.map(renderDailyPickCard).join('')
      : '<div class="market-empty">No rule-based picks available from the current package.</div>';

    gapsEl.innerHTML = gaps.length
      ? gaps.map(gap => `<div class="daily-gap-item">${escapeHtml(gap)}</div>`).join('')
      : '<div class="daily-gap-item good">Core daily package data is available.</div>';
  }

  // ============ Native Relative Value ============

  const RV_SERIES = [
    { key: 'ust', label: 'UST Yield', color: '#1f4f3a' },
    { key: 'agency', label: 'US AGY', color: '#2f6f9f' },
    { key: 'muniTey296', label: "MUNI GO 'AA' TEY (29.6%)", color: '#b5862d' },
    { key: 'muniTey21', label: "MUNI GO 'AA' TEY (21%)", color: '#6f7f3c' },
    { key: 'corp', label: "'AA' Corp", color: '#8b3f2f' }
  ];

  async function loadRelativeValueSnapshot() {
    const chart = document.getElementById('rvRateSnapshotChart');
    if (chart) chart.innerHTML = '<div class="market-empty small">Loading rate snapshot&hellip;</div>';
    try {
      const res = await fetch('/api/relative-value', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      relativeValueData = await res.json();
    } catch (e) {
      console.error('Failed to load relative value snapshot:', e);
      relativeValueData = null;
    }
    renderRelativeValueNative();
  }

  async function loadMmdCurve() {
    const chart = document.getElementById('mmdCurveChart');
    if (chart) chart.innerHTML = '<div class="market-empty small">Loading MMD curve&hellip;</div>';
    try {
      const res = await fetch('/api/mmd', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      mmdData = await res.json();
    } catch (e) {
      console.error('Failed to load MMD curve:', e);
      mmdData = null;
    }
    renderMmdCurve();
  }

  function rvRateValue(value) {
    const n = Number(value);
    return Number.isFinite(n) ? `${n.toFixed(2)}%` : '—';
  }

  function rvSpreadValue(value) {
    const n = Number(value);
    return Number.isFinite(n) ? `${n > 0 ? '+' : ''}${n.toFixed(0)}` : '—';
  }

  function bpValue(value) {
    const n = Number(value);
    return Number.isFinite(n) ? `${n > 0 ? '+' : ''}${Math.round(n)} bp` : '—';
  }

  function rvBestBy(rows, key) {
    return rows
      .filter(row => Number.isFinite(Number(row[key])))
      .sort((a, b) => Number(b[key]) - Number(a[key]))[0] || null;
  }

  function mmdRow(term) {
    const rows = mmdData && Array.isArray(mmdData.curve) ? mmdData.curve : [];
    return rows.find(row => Number(row.term) === Number(term)) || null;
  }

  function mmdRatio(term) {
    const ratios = mmdData && Array.isArray(mmdData.treasuryRatios) ? mmdData.treasuryRatios : [];
    return ratios.find(row => Number(row.term) === Number(term)) || null;
  }

  function buildMmdSalesCues(rows) {
    if (!rows.length) return [];
    const row1 = mmdRow(1);
    const row2 = mmdRow(2);
    const row5 = mmdRow(5);
    const row10 = mmdRow(10);
    const row30 = mmdRow(30);
    const ratio10 = mmdRatio(10);
    const ratio30 = mmdRatio(30);
    const cues = [];
    if (row10) {
      cues.push({
        title: '10Y benchmark',
        detail: `10Y AAA MMD is ${rvRateValue(row10.aaa)}${ratio10 ? `, ${ratio10.ratioPct}% of the ${rvRateValue(ratio10.treasuryYield)} 10Y UST.` : '.'}`
      });
    }
    if (row30) {
      cues.push({
        title: 'Long end read',
        detail: `30Y AAA MMD is ${rvRateValue(row30.aaa)}${ratio30 ? ` with an ${ratio30.ratioPct}% Treasury ratio.` : '.'}`
      });
    }
    if (row2 && row10) {
      cues.push({
        title: '2s/10s slope',
        detail: `AAA MMD 2s/10s slope is ${bpValue((Number(row10.aaa) - Number(row2.aaa)) * 100)}.`
      });
    }
    if (row10 && row30) {
      cues.push({
        title: '10s/30s slope',
        detail: `AAA MMD 10s/30s slope is ${bpValue((Number(row30.aaa) - Number(row10.aaa)) * 100)}.`
      });
    }
    if (row1 && row5) {
      cues.push({
        title: 'Front-end context',
        detail: `1Y AAA is ${rvRateValue(row1.aaa)} and 5Y AAA is ${rvRateValue(row5.aaa)}.`
      });
    }
    (Array.isArray(mmdData.notes) ? mmdData.notes : []).forEach(note => {
      cues.push({ title: 'Bloomberg note', detail: note });
    });
    return cues.slice(0, 6);
  }

  function renderMmdSalesInfo(rows) {
    const data = mmdData;
    const loadFailed = data === null;
    const row2 = mmdRow(2);
    const row10 = mmdRow(10);
    const row30 = mmdRow(30);
    const ratio10 = mmdRatio(10);
    const ratio30 = mmdRatio(30);
    const slope = row2 && row10 ? (Number(row10.aaa) - Number(row2.aaa)) * 100 : null;
    const cues = buildMmdSalesCues(rows);

    setText('mmdNativeKicker', data && data.sourceFile ? data.sourceFile : (loadFailed ? 'Not loaded' : 'Bloomberg FTAX'));
    setText('mmdSalesCueCount', cues.length ? `${cues.length} cues` : '—');
    setText('mmdRatioCount', data && Array.isArray(data.treasuryRatios) ? `${data.treasuryRatios.length} points` : '—');
    setText('mmdCurveCount', rows.length ? `${rows.length} years` : '—');

    renderStatTiles('mmdStatTiles', [
      { label: 'As Of', value: data && data.asOfDate ? formatShortDate(data.asOfDate) : '—' },
      { label: 'Coupon', value: data && data.coupon ? `${Number(data.coupon).toFixed(0)}%` : '—' },
      { label: '10Y AAA', value: row10 ? rvRateValue(row10.aaa) : '—' },
      { label: '30Y AAA', value: row30 ? rvRateValue(row30.aaa) : '—' },
      { label: '2s/10s', value: slope != null ? bpValue(slope) : '—' },
      { label: '10Y Ratio', value: ratio10 ? `${ratio10.ratioPct}%` : '—' }
    ]);

    const sales = document.getElementById('mmdSalesCues');
    if (sales) {
      sales.innerHTML = cues.length ? cues.map(cue => `
        <article class="mmd-sales-cue">
          <strong>${escapeHtml(cue.title)}</strong>
          <p>${escapeHtml(cue.detail)}</p>
        </article>
      `).join('') : `<div class="market-empty small">${loadFailed ? 'MMD curve data could not be loaded.' : 'Upload today&apos;s MMD PDF to generate sales cues.'}</div>`;
    }

    const ratios = document.getElementById('mmdRatioGrid');
    if (ratios) {
      const ratioRows = data && Array.isArray(data.treasuryRatios) ? data.treasuryRatios : [];
      ratios.innerHTML = ratioRows.length ? ratioRows.map(ratio => `
        <article class="mmd-ratio-card">
          <span>${escapeHtml(`${ratio.term}Y`)}</span>
          <strong>${escapeHtml(`${ratio.ratioPct}%`)}</strong>
          <small>UST ${escapeHtml(rvRateValue(ratio.treasuryYield))}</small>
        </article>
      `).join('') : `<div class="market-empty small">Treasury ratios unavailable.</div>`;
    }

    const body = document.getElementById('mmdCurveTableBody');
    if (body) {
      const ratioMap = new Map((data && data.treasuryRatios || []).map(row => [Number(row.term), row]));
      body.innerHTML = rows.length ? rows.map(row => {
        const ratio = ratioMap.get(Number(row.term));
        return `
          <tr>
            <td><strong>${escapeHtml(row.label || `${row.term}Y`)}</strong></td>
            <td>${escapeHtml(row.maturityYear || '—')}</td>
            <td>${escapeHtml(rvRateValue(row.aaa))}</td>
            <td>${escapeHtml(rvRateValue(row.aa))}</td>
            <td>${escapeHtml(rvRateValue(row.a))}</td>
            <td>${escapeHtml(rvRateValue(row.baa))}</td>
            <td>${ratio ? escapeHtml(`${ratio.ratioPct}%`) : '—'}</td>
          </tr>
        `;
      }).join('') : `<tr><td colspan="7">${loadFailed ? 'Could not load /api/mmd. Restart the portal server after this update.' : 'MMD curve table unavailable.'}</td></tr>`;
    }
  }

  function renderMmdCurve() {
    const el = document.getElementById('mmdCurveChart');
    if (!el) return;
    const data = mmdData;
    const mmdFile = currentPackage && currentPackage.mmd;
    const downloadBtn = document.getElementById('mmdDownloadBtn');
    if (downloadBtn) {
      if (mmdFile) {
        const src = '/current/' + encodeURIComponent(mmdFile);
        downloadBtn.style.display = '';
        downloadBtn.onclick = () => { window.location.href = src + '?download=1'; };
      } else {
        downloadBtn.style.display = 'none';
        downloadBtn.onclick = null;
      }
    }
    const rows = data && Array.isArray(data.curve) ? data.curve.filter(row => Number.isFinite(Number(row.aaa))) : [];
    setText('mmdCurveLabel', data && data.asOfDate ? formatShortDate(data.asOfDate) : (data === null ? 'MMD unavailable' : 'MMD PDF'));
    setText('mmdSub', data && data.asOfDate
      ? `AAA municipal curve from the uploaded MMD PDF · ${formatShortDate(data.asOfDate)}`
      : (data === null ? 'No MMD curve data loaded.' : 'Upload the daily MMD PDF to populate this page.'));
    renderMmdSalesInfo(rows);
    if (!rows.length) {
      el.innerHTML = '<div class="market-empty small">Upload today&apos;s MMD PDF to draw the AAA curve.</div>';
      return;
    }

    const width = 1280;
    const height = 500;
    const left = 44;
    const right = 14;
    const top = 14;
    const bottom = 34;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const values = rows.map(row => Number(row.aaa));
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const min = Math.floor((rawMin - 0.12) * 4) / 4;
    const max = Math.ceil((rawMax + 0.12) * 4) / 4;
    const range = Math.max(max - min, 0.25);
    const xFor = index => left + (rows.length <= 1 ? 0 : (index / (rows.length - 1)) * plotWidth);
    const yFor = value => top + ((max - value) / range) * plotHeight;
    const ticks = [];
    for (let v = min; v <= max + 0.001; v += 0.25) ticks.push(Number(v.toFixed(2)));

    const grid = ticks.map(tick => {
      const y = yFor(tick);
      return `
        <line x1="${left}" y1="${y.toFixed(1)}" x2="${width - right}" y2="${y.toFixed(1)}" class="rv-grid-line"></line>
        <text x="${left - 8}" y="${(y + 4).toFixed(1)}" class="rv-axis-label" text-anchor="end">${tick.toFixed(2)}</text>
      `;
    }).join('');

    const points = rows.map((row, index) => `${xFor(index).toFixed(1)},${yFor(Number(row.aaa)).toFixed(1)}`);
    const ratioMap = new Map((data.treasuryRatios || []).map(row => [Number(row.term), row]));
    const dots = rows.map((row, index) => {
      const ratio = ratioMap.get(Number(row.term));
      const title = `${row.label} · ${formatTooltipYield(row.aaa)}`;
      const ratioText = ratio ? `<text x="${xFor(index).toFixed(1)}" y="${(yFor(Number(row.aaa)) - 10).toFixed(1)}" class="rv-axis-label mmd-ratio-label" text-anchor="middle">${ratio.ratioPct}%</text>` : '';
      const cx = xFor(index).toFixed(1);
      const cy = yFor(Number(row.aaa)).toFixed(1);
      return `
        <circle cx="${cx}" cy="${cy}" r="${ratio ? 5.5 : 4.4}" fill="#18735A"></circle>
        ${ratioText}
        <circle class="chart-hit-point" cx="${cx}" cy="${cy}" r="16" data-chart-tooltip="${escapeHtml(title)}" tabindex="0" aria-label="${escapeHtml(title)}"></circle>
      `;
    }).join('');

    const xLabels = rows
      .filter(row => row.term === 1 || row.term % 5 === 0 || row.term === 30)
      .map(row => {
        const index = rows.indexOf(row);
        return `<text x="${xFor(index).toFixed(1)}" y="${height - 18}" class="rv-axis-label" text-anchor="middle">${escapeHtml(row.label)}</text>`;
      }).join('');

    const notes = [
      data.coupon ? `${Number(data.coupon).toFixed(0)}% coupon` : '',
      ...(Array.isArray(data.notes) ? data.notes : [])
    ].filter(Boolean).join(' · ');

    el.innerHTML = `
      <div class="rv-line-legend">
        <span><i style="background:#18735A"></i>MMD AAA</span>
        <span><i style="background:#8c9a92"></i>Treasury ratio labels</span>
        ${notes ? `<span>${escapeHtml(notes)}</span>` : ''}
      </div>
      <svg class="mmd-curve-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="MMD AAA curve">
        <rect x="${left}" y="${top}" width="${plotWidth}" height="${plotHeight}" class="rv-plot-bg"></rect>
        ${grid}
        <line x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}" class="rv-axis-line"></line>
        <line x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}" class="rv-axis-line"></line>
        <polyline points="${points.join(' ')}" fill="none" stroke="#18735A" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"></polyline>
        ${dots}
        ${xLabels}
      </svg>
    `;
  }

  function renderRelativeValueChart(rows) {
    const el = document.getElementById('rvRateSnapshotChart');
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = '<div class="market-empty small">Rate snapshot table unavailable.</div>';
      return;
    }

    const width = 860;
    const height = 340;
    const left = 54;
    const right = 24;
    const top = 24;
    const bottom = 46;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const values = [];
    rows.forEach(row => {
      RV_SERIES.forEach(series => {
        const value = Number(row[series.key]);
        if (Number.isFinite(value)) values.push(value);
      });
    });
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const min = Math.floor((rawMin - 0.12) * 4) / 4;
    const max = Math.ceil((rawMax + 0.12) * 4) / 4;
    const range = Math.max(max - min, 0.25);
    const xFor = index => left + (rows.length <= 1 ? 0 : (index / (rows.length - 1)) * plotWidth);
    const yFor = value => top + ((max - value) / range) * plotHeight;
    const ticks = [];
    for (let v = min; v <= max + 0.001; v += 0.25) ticks.push(Number(v.toFixed(2)));

    const grid = ticks.map(tick => {
      const y = yFor(tick);
      return `
        <line x1="${left}" y1="${y.toFixed(1)}" x2="${width - right}" y2="${y.toFixed(1)}" class="rv-grid-line"></line>
        <text x="${left - 10}" y="${(y + 4).toFixed(1)}" class="rv-axis-label" text-anchor="end">${tick.toFixed(2)}</text>
      `;
    }).join('');

    const seriesSvg = RV_SERIES.map(series => {
      const points = rows.map((row, index) => {
        const value = Number(row[series.key]);
        return Number.isFinite(value) ? `${xFor(index).toFixed(1)},${yFor(value).toFixed(1)}` : null;
      }).filter(Boolean);
      if (points.length < 2) return '';
      const dots = rows.map((row, index) => {
        const value = Number(row[series.key]);
        if (!Number.isFinite(value)) return '';
        const label = `${row.term} · ${series.label} · ${formatTooltipYield(value)}`;
        const cx = xFor(index).toFixed(1);
        const cy = yFor(value).toFixed(1);
        return `
          <circle cx="${cx}" cy="${cy}" r="4.5" fill="${series.color}"></circle>
          <circle class="chart-hit-point" cx="${cx}" cy="${cy}" r="13" data-chart-tooltip="${escapeHtml(label)}" tabindex="0" aria-label="${escapeHtml(label)}"></circle>
        `;
      }).join('');
      return `
        <polyline points="${points.join(' ')}" fill="none" stroke="${series.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></polyline>
        ${dots}
      `;
    }).join('');

    const xLabels = rows.map((row, index) => `
      <text x="${xFor(index).toFixed(1)}" y="${height - 18}" class="rv-axis-label" text-anchor="middle">${escapeHtml(row.term)}</text>
    `).join('');

    const legend = RV_SERIES.map(series => `
      <span><i style="background:${series.color}"></i>${escapeHtml(series.label)}</span>
    `).join('');

    el.innerHTML = `
      <div class="rv-line-legend">${legend}</div>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Relative value rate snapshot line chart">
        <rect x="${left}" y="${top}" width="${plotWidth}" height="${plotHeight}" class="rv-plot-bg"></rect>
        ${grid}
        <line x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}" class="rv-axis-line"></line>
        <line x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}" class="rv-axis-line"></line>
        ${seriesSvg}
        ${xLabels}
      </svg>
    `;
  }

  function renderRelativeValueNative() {
    const tool = document.getElementById('relativeValueTool');
    if (!tool) return;
    const data = relativeValueData;
    const rows = data && Array.isArray(data.rows) ? data.rows : [];
    const loadFailed = data === null;
    const ten = rows.find(row => row.term === '10 Yr');
    const two = rows.find(row => row.term === '2 Yr');
    const topAgency = rvBestBy(rows, 'agencySpread');
    const topCorp = rvBestBy(rows, 'corpSpread');
    const topMuni = rvBestBy(rows, 'muniTey296');

    setText('relativeValueNativeKicker', data && data.asOfDate ? formatShortDate(data.asOfDate) : (loadFailed ? 'Not loaded' : 'Current package'));
    setText('rvRateChartLabel', data && data.sourceFile ? data.sourceFile : (loadFailed ? 'Snapshot unavailable' : 'Relative Value PDF'));
    renderStatTiles('relativeValueStatTiles', [
      { label: '2Y UST', value: two ? rvRateValue(two.ust) : '—' },
      { label: '10Y UST', value: ten ? rvRateValue(ten.ust) : '—' },
      { label: '2s/10s', value: two && ten ? `${((ten.ust - two.ust) * 100).toFixed(0)} bp` : '—' },
      { label: 'Best Agency Pickup', value: topAgency ? `${rvSpreadValue(topAgency.agencySpread)} bp` : '—' },
      { label: 'Best Corp Pickup', value: topCorp ? `${rvSpreadValue(topCorp.corpSpread)} bp` : '—' },
      { label: 'Top Muni TEY 29.6%', value: topMuni ? rvRateValue(topMuni.muniTey296) : '—' }
    ]);
    renderRelativeValueChart(rows);

    const body = document.getElementById('rvRateSnapshotTableBody');
    if (body) {
      body.innerHTML = rows.length ? rows.map(row => `
        <tr>
          <td><strong>${escapeHtml(row.term)}</strong></td>
          <td>${escapeHtml(rvRateValue(row.ust))}</td>
          <td>${escapeHtml(rvRateValue(row.agency))}</td>
          <td>${escapeHtml(rvSpreadValue(row.agencySpread))}</td>
          <td>${escapeHtml(rvRateValue(row.muni))}</td>
          <td>${escapeHtml(rvRateValue(row.muniTey296))}</td>
          <td>${escapeHtml(rvRateValue(row.muniTey21))}</td>
          <td>${escapeHtml(rvRateValue(row.corp))}</td>
          <td>${escapeHtml(rvSpreadValue(row.corpSpread))}</td>
        </tr>
      `).join('') : `<tr><td colspan="9">${loadFailed ? 'Could not load /api/relative-value. Restart the portal server after this update.' : 'Rate snapshot table unavailable.'}</td></tr>`;
    }
  }

  // ============ Brokered CD Cost Calculator ============

  function parseMoneyInput(value) {
    const clean = String(value || '').replace(/[^0-9.]/g, '');
    const parsed = Number(clean);
    return isNaN(parsed) ? 0 : parsed;
  }

  function formatTermMonths(months) {
    const n = Number(months);
    if (!n || isNaN(n)) return 'Manual';
    if (n % 12 === 0) return `${n / 12} yr`;
    if (n < 12) return `${n} mo`;
    return `${(n / 12).toFixed(1).replace(/\.0$/, '')} yr`;
  }

  function renderCdCostCalculator() {
    const termButtons = document.getElementById('cdCalcTermButtons');
    const rateInput = document.getElementById('cdCalcRate');
    if (!termButtons || !rateInput) return;

    const terms = getBrokeredCdTerms();
    termButtons.innerHTML = terms.map(term => `
      <button type="button" class="${term.months === selectedCdCalcTerm ? 'active' : ''}" data-cd-term="${term.months}">
        <span>${escapeHtml(term.label)}</span>
        <strong>${escapeHtml(formatPercentTile(term.mid, 3))}</strong>
      </button>
    `).join('');

    const selected = terms.find(term => term.months === selectedCdCalcTerm) || terms[0];
    selectedCdCalcTerm = selected.months;
    rateInput.value = selected.mid.toFixed(3);
    calculateCdCost();
  }

  function getBrokeredCdTerms() {
    const uploadedTerms = currentPackage && Array.isArray(currentPackage.brokeredCdTerms)
      ? currentPackage.brokeredCdTerms
      : [];
    return uploadedTerms.length ? uploadedTerms : DEFAULT_BROKERED_CD_TERMS;
  }

  function calculateCdCost() {
    const amountInput = document.getElementById('cdCalcAmount');
    const rateInput = document.getElementById('cdCalcRate');
    const annualEl = document.getElementById('cdCalcAnnualCost');
    const termEl = document.getElementById('cdCalcTermCost');
    const monthlyEl = document.getElementById('cdCalcMonthlyCost');
    const metaEl = document.getElementById('cdCalcResultMeta');
    if (!amountInput || !rateInput || !annualEl || !termEl || !monthlyEl || !metaEl) return;

    const terms = getBrokeredCdTerms();
    const selected = terms.find(term => term.months === selectedCdCalcTerm) || terms[0];
    const months = selected.months;
    const amount = parseMoneyInput(amountInput.value);
    const rate = Number(rateInput.value);

    if (!amount || isNaN(rate)) {
      annualEl.textContent = '—';
      termEl.textContent = '—';
      monthlyEl.textContent = '—';
      metaEl.textContent = 'Enter an amount and rate to calculate cost.';
      return;
    }

    const annualCost = amount * (rate / 100);
    const termCost = annualCost * (months / 12);
    annualEl.textContent = formatMoney(annualCost);
    termEl.textContent = formatMoney(termCost);
    monthlyEl.textContent = formatMoney(annualCost / 12);
    metaEl.textContent = `${formatMoney(amount)} issued at ${formatPercentTile(rate, 3)} all-in mid for ${formatTermMonths(months)}`;
  }

  function setupCdCostCalculator() {
    const termButtons = document.getElementById('cdCalcTermButtons');
    const amountInput = document.getElementById('cdCalcAmount');
    const rateInput = document.getElementById('cdCalcRate');
    if (!termButtons || !amountInput || !rateInput) return;

    termButtons.addEventListener('click', e => {
      const btn = e.target.closest('[data-cd-term]');
      if (!btn) return;
      selectedCdCalcTerm = Number(btn.dataset.cdTerm);
      const selected = getBrokeredCdTerms().find(term => term.months === selectedCdCalcTerm);
      if (selected) rateInput.value = selected.mid.toFixed(3);
      termButtons.querySelectorAll('[data-cd-term]').forEach(button => {
        button.classList.toggle('active', button === btn);
      });
      calculateCdCost();
    });
    amountInput.addEventListener('input', calculateCdCost);
    amountInput.addEventListener('blur', () => {
      const amount = parseMoneyInput(amountInput.value);
      amountInput.value = amount ? formatMoney(amount) : '';
      calculateCdCost();
    });
    rateInput.addEventListener('input', calculateCdCost);

    document.querySelectorAll('[data-cd-amount]').forEach(btn => {
      btn.addEventListener('click', () => {
        amountInput.value = formatMoney(Number(btn.dataset.cdAmount || 0));
        calculateCdCost();
      });
    });
  }

  // ============ Brokered CD Opportunity Screen ============

  function setupCdOpportunityTool() {
    const input = document.getElementById('cdOpportunityBankInput');
    const btn = document.getElementById('cdOpportunityBankBtn');
    const upload = document.getElementById('wirpWorkbookInput');
    const results = document.getElementById('cdOpportunityBankResults');
    if (input) {
      input.addEventListener('input', () => {
        clearTimeout(cdOpportunitySearchTimer);
        cdOpportunitySearchTimer = setTimeout(() => searchCdOpportunityBanks(input.value), 180);
      });
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          clearTimeout(cdOpportunitySearchTimer);
          searchCdOpportunityBanks(input.value, { openFirst: true });
        }
      });
    }
    if (btn) {
      btn.addEventListener('click', () => searchCdOpportunityBanks(input ? input.value : '', { openFirst: true }));
    }
    if (upload) {
      upload.addEventListener('change', e => {
        const file = e.target.files && e.target.files[0];
        if (file) uploadWirpWorkbook(file);
      });
    }
    if (results) {
      results.addEventListener('click', e => {
        const btnEl = e.target.closest('[data-cd-opportunity-bank]');
        if (!btnEl) return;
        e.preventDefault();
        clearTimeout(cdOpportunitySearchTimer);
        const bankId = btnEl.getAttribute('data-cd-opportunity-bank');
        const label = btnEl.querySelector('strong')?.textContent || '';
        if (input && label) input.value = label;
        results.innerHTML = '';
        loadCdOpportunityBank(bankId);
      });
    }
    loadWirpStatus();
  }

  async function loadWirpStatus() {
    const el = document.getElementById('wirpStatus');
    try {
      const res = await fetch('/api/brokered-cd/wirp', { cache: 'no-store' });
      wirpStatusData = await readBankJson(res);
      renderWirpStatus();
    } catch (e) {
      if (el) el.textContent = brokeredCdApiMessage(e);
    }
  }

  function brokeredCdApiMessage(error) {
    const message = error && error.message ? error.message : String(error || 'Request failed');
    if (/api endpoint not found/i.test(message)) {
      return 'Brokered CD API is not active in the running portal process. Restart the portal, then refresh this page.';
    }
    return message;
  }

  function renderWirpStatus() {
    const el = document.getElementById('wirpStatus');
    if (!el) return;
    const data = wirpStatusData || {};
    if (!data.available) {
      el.innerHTML = '<strong>WIRP not loaded.</strong> Upload a Bloomberg WIRP export to add forward-rate term guidance.';
      return;
    }
    const summary = data.summary || {};
    const warning = Array.isArray(data.warnings) && data.warnings.length ? ` · ${data.warnings[0]}` : '';
    el.innerHTML = `
      <strong>${escapeHtml(summary.biasLabel || 'WIRP loaded')}</strong>
      <span>${escapeHtml(data.sourceFile || 'WIRP export')} · ${escapeHtml(formatFullTimestamp(data.uploadedAt))} · ${escapeHtml(formatNumber(data.recordCount || 0))} rows${escapeHtml(warning)}</span>
    `;
  }

  function uploadWirpWorkbook(file) {
    const status = document.getElementById('wirpStatus');
    const input = document.getElementById('wirpWorkbookInput');
    const formData = new FormData();
    formData.append('wirpWorkbook', file, file.name);
    if (status) status.textContent = `Importing WIRP from ${file.name}...`;
    fetch('/api/brokered-cd/wirp/upload', { method: 'POST', body: formData })
      .then(async res => {
        const data = await readBankJson(res);
        wirpStatusData = {
          available: true,
          sourceFile: data.wirp && data.wirp.sourceFile,
          uploadedAt: data.wirp && data.wirp.uploadedAt,
          sheetName: data.wirp && data.wirp.sheetName,
          recordCount: data.wirp && Array.isArray(data.wirp.records) ? data.wirp.records.length : 0,
          summary: data.wirp && data.wirp.summary,
          warnings: data.wirp && data.wirp.warnings || []
        };
        renderWirpStatus();
        showToast(`Imported WIRP · ${wirpStatusData.summary && wirpStatusData.summary.biasLabel || 'forward path loaded'}`);
        if (cdOpportunityAnalysis && cdOpportunityAnalysis.bank && cdOpportunityAnalysis.bank.id) {
          return loadCdOpportunityBank(cdOpportunityAnalysis.bank.id);
        }
        return null;
      })
      .catch(err => {
        const message = brokeredCdApiMessage(err);
        showToast(message, true);
        if (status) status.textContent = message;
      })
      .finally(() => {
        if (input) input.value = '';
      });
  }

  async function searchCdOpportunityBanks(query, options = {}) {
    const results = document.getElementById('cdOpportunityBankResults');
    const q = String(query || '').trim();
    if (!results) return;
    if (q.length < 2) {
      results.innerHTML = '';
      return;
    }
    results.innerHTML = '<div class="bank-search-empty">Searching banks...</div>';
    try {
      const res = await fetch(`/api/banks/search?q=${encodeURIComponent(q)}&limit=8`, { cache: 'no-store' });
      const data = await readBankJson(res);
      const rows = data.results || [];
      if (options.openFirst && rows[0]) {
        await loadCdOpportunityBank(rows[0].id);
        results.innerHTML = '';
        return;
      }
      renderCdOpportunityBankResults(rows);
    } catch (e) {
      results.innerHTML = `<div class="bank-search-empty">${escapeHtml(brokeredCdApiMessage(e))}</div>`;
    }
  }

  function renderCdOpportunityBankResults(rows) {
    const results = document.getElementById('cdOpportunityBankResults');
    if (!results) return;
    if (!rows.length) {
      results.innerHTML = '<div class="bank-search-empty">No matching banks found.</div>';
      return;
    }
    results.innerHTML = rows.map(row => `
      <button type="button" class="reports-peer-result" data-cd-opportunity-bank="${escapeHtml(row.id)}">
        <span>
          <strong>${escapeHtml(bankDisplayName(row))}</strong>
          <span>${escapeHtml([row.city, row.state, row.certNumber ? `Cert ${row.certNumber}` : '', row.period].filter(Boolean).join(' · '))}</span>
        </span>
        <span class="text-btn">Analyze</span>
      </button>
    `).join('');
  }

  async function loadCdOpportunityBank(bankId) {
    const output = document.getElementById('cdOpportunityOutput');
    if (output) output.innerHTML = '<div class="bank-search-empty">Analyzing funding fit...</div>';
    try {
      const res = await fetch(`/api/brokered-cd/opportunity?bankId=${encodeURIComponent(bankId)}`, { cache: 'no-store' });
      const data = await readBankJson(res);
      cdOpportunityAnalysis = data.analysis;
      renderCdOpportunityAnalysis(cdOpportunityAnalysis);
    } catch (e) {
      if (output) output.innerHTML = `<div class="bank-search-empty">${escapeHtml(brokeredCdApiMessage(e))}</div>`;
    }
  }

  function formatOpportunityMetric(metric) {
    if (!metric) return '—';
    if (metric.type === 'money') return metric.current == null ? '—' : `$${formatNumber(Math.round(metric.current))}`;
    return metric.current == null ? '—' : formatPercentTile(metric.current, 2);
  }

  function formatOpportunityDelta(value, type) {
    if (value == null) return '—';
    const sign = value > 0 ? '+' : '';
    if (type === 'money') return `${sign}$${formatNumber(Math.round(value))}`;
    return `${sign}${Number(value).toFixed(2)} pts`;
  }

  function cdOpportunityTone(recommendation) {
    if (recommendation === 'Likely candidate') return 'likely';
    if (recommendation === 'Possible candidate') return 'possible';
    return 'low';
  }

  function renderCdOpportunityAnalysis(analysis) {
    const output = document.getElementById('cdOpportunityOutput');
    if (!output || !analysis) return;
    const bank = analysis.bank || {};
    const term = analysis.termRecommendation || {};
    const wirp = analysis.wirp || {};
    const tone = cdOpportunityTone(analysis.recommendation);
    output.innerHTML = `
      <div class="cd-opportunity-card ${tone}">
        <div class="cd-opportunity-head">
          <div>
            <span class="tool-eyebrow">${escapeHtml(bank.period || '')}</span>
            <h3>${escapeHtml(bank.displayName || 'Selected bank')}</h3>
            <p>${escapeHtml([bank.city, bank.state, bank.certNumber ? `Cert ${bank.certNumber}` : ''].filter(Boolean).join(' · '))}</p>
          </div>
          <div class="cd-opportunity-verdict">
            <span>${escapeHtml(analysis.recommendation || 'Review')}</span>
            <strong>${escapeHtml(String(analysis.score || 0))}</strong>
          </div>
        </div>
        <div class="cd-opportunity-summary-grid">
          <div>
            <span>Suggested Size</span>
            <strong>${escapeHtml(analysis.amount && analysis.amount.label || 'Sizing pending')}</strong>
            <p>${escapeHtml(analysis.amount && analysis.amount.detail || '')}</p>
          </div>
          <div>
            <span>Suggested Term</span>
            <strong>${escapeHtml(term.summary || 'Term pending')}</strong>
            <p>${escapeHtml((term.rationale || [])[0] || '')}</p>
          </div>
          <div>
            <span>Forward Path</span>
            <strong>${escapeHtml(wirp.summary && wirp.summary.biasLabel || 'WIRP pending')}</strong>
            <p>${escapeHtml(wirp.summary && wirp.summary.explanation || 'Upload WIRP to add forward-rate analysis.')}</p>
          </div>
        </div>
        <div class="cd-opportunity-metrics">
          ${(analysis.metrics || []).map(metric => `
            <div>
              <span>${escapeHtml(metric.label)}</span>
              <strong>${escapeHtml(formatOpportunityMetric(metric))}</strong>
              <em>QoQ ${escapeHtml(formatOpportunityDelta(metric.qoq, metric.type))}${metric.peerDelta != null ? ` · Peer ${escapeHtml(formatOpportunityDelta(metric.peerDelta, metric.type))}` : ''}</em>
            </div>
          `).join('')}
        </div>
        <div class="cd-opportunity-columns">
          <section>
            <h4>Signals</h4>
            ${(analysis.signals || []).length ? analysis.signals.map(signal => `
              <article class="cd-signal ${escapeHtml(signal.tone || '')}">
                <strong>${escapeHtml(signal.title)}</strong>
                <span>${escapeHtml(signal.detail)}</span>
                <em>${signal.points > 0 ? '+' : ''}${escapeHtml(String(signal.points))}</em>
              </article>
            `).join('') : '<div class="bank-search-empty">No strong funding pressure signals yet.</div>'}
          </section>
          <section>
            <h4>Term Stack</h4>
            ${(term.terms || []).length ? term.terms.map(row => `
              <article class="cd-term-row">
                <strong>${escapeHtml(row.label)}</strong>
                <span>${escapeHtml(formatPercentTile(row.mid, 3))} midpoint</span>
                <em>${row.low != null && row.high != null ? `${escapeHtml(formatPercentTile(row.low, 3))} - ${escapeHtml(formatPercentTile(row.high, 3))}` : ''}</em>
              </article>
            `).join('') : '<div class="bank-search-empty">Upload the Brokered CD Sheet to rank terms.</div>'}
          </section>
        </div>
        <section class="cd-talking-points">
          <h4>Talking Points</h4>
          ${(analysis.talkingPoints || []).map(point => `<p>${escapeHtml(point)}</p>`).join('')}
        </section>
      </div>
    `;
  }

  // ============ Archive ============

  function renderArchive() {
    const tbody = document.getElementById('archiveBody');
    const countEl = document.getElementById('archiveCount');

    const hasCurrent = currentPackage && (SLOTS.some(s => currentPackage[s]) || currentPackage.cdoffersCost || currentPackage.mmd);
    const total = archiveData.length + (hasCurrent ? 1 : 0);
    countEl.textContent = total;

    const rows = [];
    if (hasCurrent) rows.push(renderArchiveRow(currentPackage, true));
    archiveData.forEach(day => rows.push(renderArchiveRow(day, false)));

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:40px;color:var(--text3)">
        No publications yet. Upload your first package to get started.
      </td></tr>`;
    } else {
      tbody.innerHTML = rows.join('');
    }
  }

  function renderArchiveRow(day, isCurrent) {
    const date = day.date || '—';
    const basePath = isCurrent ? '/current/' : `/archive/${date}/`;

    const chip = (file, label) => {
      if (file) {
        return `<a class="file-chip" href="${basePath}${encodeURIComponent(file)}" target="_blank" rel="noopener" title="${escapeHtml(file)}">${label}</a>`;
      }
      return `<span class="file-chip missing">${label}</span>`;
    };

    const publishedText = day.publishedAt
      ? `${escapeHtml(day.publishedBy || 'Portal User')} · ${formatTime(day.publishedAt)}`
      : '—';

    const viewFirst = day.dashboard || day.econ || day.relativeValue || day.mmd || day.treasuryNotes || day.cd || day.cdoffers || day.cdoffersCost || day.munioffers;
    const viewLink = viewFirst ? `${basePath}${encodeURIComponent(viewFirst)}` : '#';
    const rowClass = isCurrent ? 'current-row' : '';
    const cdOfferIsWorkbook = day.cdoffers && /\.(xlsx|xlsm|xls)$/i.test(day.cdoffers);
    const costFile = day.cdoffersCost && day.cdoffersCost !== day.cdoffers ? day.cdoffersCost : null;
    const qualityHtml = renderArchiveQuality(day, { cdOfferIsWorkbook, costFile });

    return `
      <tr class="${rowClass}">
        <td class="arch-date-cell">
          ${formatShortDate(date)}${isCurrent ? ' <span class="current-badge">Current</span>' : ''}
        </td>
        <td>
          ${chip(day.dashboard, 'Dashboard.html')}
          ${chip(day.econ, 'Econ_Update.pdf')}
          ${chip(day.relativeValue, 'Relative_Value.pdf')}
          ${chip(day.mmd, 'MMD.pdf')}
          ${chip(day.treasuryNotes, 'Treasury_Notes.xlsx')}
          ${chip(day.cd, 'CD_Rate_Sheet.pdf')}
          ${chip(cdOfferIsWorkbook ? null : day.cdoffers, 'CD_Offerings.pdf')}
          ${chip(cdOfferIsWorkbook ? day.cdoffers : costFile, 'CD_Internal.xlsx')}
          ${chip(day.munioffers, 'Muni_Offerings.pdf')}
          ${qualityHtml}
        </td>
        <td>${publishedText}</td>
        <td style="text-align:right">
          ${viewFirst ? `<a class="small-btn" href="${viewLink}" target="_blank" rel="noopener">View</a>` : ''}
        </td>
      </tr>
    `;
  }

  function renderArchiveQuality(day, context = {}) {
    const countChip = (label, value) => {
      const n = Number(value);
      const ok = Number.isFinite(n) && n > 0;
      return `<span class="archive-quality-pill ${ok ? 'ok' : 'warn'}">${escapeHtml(label)} ${ok ? formatNumber(n) : 'missing'}</span>`;
    };
    const warnings = Number(day.warningCount || day.warningsCount || 0);
    const cdInternalReady = Boolean(day.cdoffersCost || context.costFile || context.cdOfferIsWorkbook);
    const pills = [
      countChip('CD rows', day.offeringsCount),
      countChip('Treasury rows', day.treasuryNotesCount),
      countChip('Muni rows', day.muniOfferingsCount),
      countChip('Agency rows', day.agencyCount),
      countChip('Corp rows', day.corporatesCount),
      `<span class="archive-quality-pill ${cdInternalReady ? 'ok' : ''}">CD internal ${cdInternalReady ? 'loaded' : 'optional'}</span>`,
      `<span class="archive-quality-pill ${warnings ? 'warn' : 'ok'}">${warnings ? `${formatNumber(warnings)} warnings` : 'No warnings'}</span>`
    ];
    return `<div class="archive-quality">${pills.join('')}</div>`;
  }

  // ============ Upload ============

  function setupUpload() {
    const dropZones = document.querySelectorAll('.drop-zone');
    const folderScanBtn = document.getElementById('folderDropScanBtn');
    const folderPublishBtn = document.getElementById('folderDropPublishBtn');

    dropZones.forEach(zone => {
      const input = zone.querySelector('input[type="file"]');
      const slot = zone.dataset.slot;

      zone.addEventListener('click', e => {
        if (e.target !== input) input.click();
      });

      input.addEventListener('change', e => {
        if (e.target.files && e.target.files[0]) {
          handleFileSelect(slot, e.target.files[0], zone);
        }
      });

      ['dragenter', 'dragover'].forEach(ev => {
        zone.addEventListener(ev, e => {
          e.preventDefault();
          e.stopPropagation();
          zone.classList.add('dragover');
        });
      });
      ['dragleave', 'drop'].forEach(ev => {
        zone.addEventListener(ev, e => {
          e.preventDefault();
          e.stopPropagation();
          zone.classList.remove('dragover');
        });
      });
      zone.addEventListener('drop', e => {
        const files = e.dataTransfer.files;
        if (files && files[0]) handleFileSelect(slot, files[0], zone);
      });
    });

    document.getElementById('uploadForm').addEventListener('submit', async e => {
      e.preventDefault();
      await publishPackage();
    });
    if (folderScanBtn) folderScanBtn.addEventListener('click', () => scanFolderDrop());
    if (folderPublishBtn) folderPublishBtn.addEventListener('click', publishFolderDrop);
    scanFolderDrop({ silent: true });
  }

  function setupGlobalSearch() {
    const input = document.getElementById('globalSearchInput');
    if (!input) return;
    input.addEventListener('input', renderGlobalSearch);
  }

  // ============ Bank Tear Sheets ============

  async function loadBankStatus() {
    const sub = document.getElementById('bankTearSheetSub');
    const count = document.getElementById('bankDataCount');
    const status = document.getElementById('bankImportStatus');
    const accountStatus = document.getElementById('bankStatusImportStatus');
    const averagedSeriesStatus = document.getElementById('averagedSeriesImportStatus');
    const reportsAveragedSeriesImportStatus = document.getElementById('reportsAveragedSeriesImportStatus');
    try {
      const res = await fetch('/api/banks/status', { cache: 'no-store' });
      bankDataStatus = await readBankJson(res);
    } catch (e) {
      bankDataStatus = { available: false, error: e.message };
    }

    if (bankDataStatus && bankDataStatus.available) {
      const meta = bankDataStatus.metadata || {};
      if (sub) sub.textContent = `Imported ${formatNumber(bankDataStatus.bankCount || meta.bankCount)} banks · latest period ${meta.latestPeriod || '—'}`;
      if (count) count.textContent = formatNumber(bankDataStatus.bankCount || meta.bankCount);
      if (status) status.textContent = `${meta.sourceFile || 'Workbook'} imported ${formatImportedDate(meta.importedAt)} · ${formatNumber(meta.rowCount)} rows · latest ${meta.latestPeriod || '—'}`;
    } else {
      if (sub) sub.textContent = bankDataStatus.error || 'Upload the SNL call report workbook to enable bank tear sheet search.';
      if (count) count.textContent = '0';
      if (status) status.textContent = bankDataStatus.error || 'No bank workbook has been imported yet.';
    }

    const statusMeta = bankDataStatus && bankDataStatus.accountStatuses ? bankDataStatus.accountStatuses : {};
    const importMeta = statusMeta.metadata || {};
    if (accountStatus && statusMeta.available) {
      const source = importMeta.sourceFile || 'Account status workbook';
      const countText = `${formatNumber(statusMeta.statusCount || importMeta.importedCount || 0)} statuses`;
      const unmatchedText = importMeta.unmatchedCount !== undefined ? ` · ${formatNumber(importMeta.unmatchedCount)} unmatched` : '';
      const ownerText = importMeta.ownerCount !== undefined ? ` · ${formatNumber(importMeta.ownerCount || 0)} owners` : '';
      const servicesText = importMeta.servicesCount !== undefined ? ` · ${formatNumber(importMeta.servicesCount || 0)} FBBS service rows` : '';
      const bankersBankText = importMeta.bankersBankServicesCount !== undefined ? ` · ${formatNumber(importMeta.bankersBankServicesCount || 0)} Bankers Bank service rows` : '';
      accountStatus.textContent = `${source} imported ${formatImportedDate(importMeta.importedAt)} · ${countText}${unmatchedText}${ownerText}${servicesText}${bankersBankText}`;
    } else if (accountStatus) {
      accountStatus.textContent = 'Account statuses default to Open until imported or edited.';
    }

    const averagedMeta = bankDataStatus && bankDataStatus.averagedSeries ? bankDataStatus.averagedSeries : {};
    const averagedImportMeta = averagedMeta.metadata || {};
    if (averagedMeta.available) {
      const averagedDataset = averagedMeta.dataset || {};
      const text = `${averagedImportMeta.sourceFile || 'Averaged-series workbook'} imported ${formatImportedDate(averagedImportMeta.importedAt)} · latest ${averagedImportMeta.latestPeriod || '—'} · ${formatNumber(averagedDataset.metricCount || averagedImportMeta.metricCount || 0)} metrics · ${formatNumber(averagedDataset.seriesRowCount || averagedImportMeta.seriesRowCount || 0)} peer rows`;
      if (averagedSeriesStatus) averagedSeriesStatus.textContent = text;
      if (reportsAveragedSeriesImportStatus) reportsAveragedSeriesImportStatus.textContent = text;
    } else {
      const text = averagedMeta.error || 'Averaged-series peer data has not been imported yet.';
      if (averagedSeriesStatus) averagedSeriesStatus.textContent = text;
      if (reportsAveragedSeriesImportStatus) reportsAveragedSeriesImportStatus.textContent = text;
    }

    if (typeof renderHomeTileAccounts === 'function') renderHomeTileAccounts();
    if (parseHashTarget(window.location.hash || '#home').page === 'reports') renderReportsWorkspace();
  }

  async function loadBondAccountingManifest() {
    const list = document.getElementById('bondAccountingMatchList');
    try {
      const res = await fetch('/api/banks/bond-accounting', { cache: 'no-store' });
      bondAccountingManifest = await readBankJson(res);
    } catch (e) {
      bondAccountingManifest = null;
      if (list) list.innerHTML = '<div class="bank-search-empty">No bond accounting import has been run yet.</div>';
      return;
    }
    renderBondAccountingMatches();
    if (parseHashTarget(window.location.hash || '#home').page === 'reports') renderReportsWorkspace();
  }

  function bondAccountingFileUrl(row) {
    return `/api/banks/bond-accounting/files/${encodeURIComponent(row.storedPath || '')}`;
  }

  function bondAccountingStatusLabel(row) {
    if (!row) return 'Unmatched';
    if (row.status === 'matched') return 'Matched';
    if (row.status === 'needs-bank-data-match') return 'P-code only';
    if (row.status === 'unmatched-pcode') return 'Unmatched P-code';
    return row.status || 'Unmatched';
  }

  function bondAccountingReviewCounts(source) {
    const pCodeOnly = Number(source && source.pCodeMatchedCount) || 0;
    let unmatchedPCode = 0;
    if (source && Array.isArray(source.matches)) {
      unmatchedPCode = source.matches.filter(row => row.status === 'unmatched-pcode').length;
    } else {
      unmatchedPCode = Math.max(0, (Number(source && source.unmatchedCount) || 0) - pCodeOnly);
    }
    return {
      matched: Number(source && source.matchedCount) || 0,
      pCodeOnly,
      unmatchedPCode,
      needsReview: pCodeOnly + unmatchedPCode
    };
  }

  function bondAccountingSearchText(row) {
    const bankList = row && row.bankList ? row.bankList : {};
    return [
      row.bankDisplayName,
      row.portfolioClientName,
      row.filename,
      row.pCode,
      row.reportDate,
      row.certNumber,
      row.account,
      row.matchedBy,
      bankList.clientName,
      bankList.account,
      bankList.city,
      bankList.state,
      bankList.salesRep
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function filteredBondAccountingRows() {
    const rows = bondAccountingManifest && Array.isArray(bondAccountingManifest.matches)
      ? bondAccountingManifest.matches
      : [];
    const search = String(bondAccountingFilters.search || '').trim().toLowerCase();
    const status = bondAccountingFilters.status || '';
    return rows.filter(row => {
      if (status && row.status !== status) return false;
      if (search && !bondAccountingSearchText(row).includes(search)) return false;
      return true;
    });
  }

  function renderBondAccountingStats(rows) {
    const stats = document.getElementById('bondAccountingMatchStats');
    if (!stats) return;
    const sourceRows = Array.isArray(rows) ? rows : [];
    renderStatTiles('bondAccountingMatchStats', [
      { label: 'Shown', value: formatNumber(sourceRows.length) },
      { label: 'Matched', value: formatNumber(sourceRows.filter(row => row.status === 'matched').length) },
      { label: 'P-code only', value: formatNumber(sourceRows.filter(row => row.status === 'needs-bank-data-match').length) },
      { label: 'Unmatched', value: formatNumber(sourceRows.filter(row => row.status === 'unmatched-pcode').length) }
    ]);
  }

  function renderBondAccountingMatches() {
    const list = document.getElementById('bondAccountingMatchList');
    const status = document.getElementById('bondAccountingImportStatus');
    if (!list || !bondAccountingManifest) return;
    const allRows = Array.isArray(bondAccountingManifest.matches) ? bondAccountingManifest.matches : [];
    const rows = filteredBondAccountingRows();
    if (status) {
      const filteredText = rows.length === allRows.length ? '' : ` · showing ${formatNumber(rows.length)} filtered`;
      const counts = bondAccountingReviewCounts(bondAccountingManifest);
      status.textContent = `Last import: ${formatNumber(counts.matched)} matched, ${formatNumber(counts.pCodeOnly)} P-code only, ${formatNumber(counts.unmatchedPCode)} unmatched P-code${filteredText}.`;
    }
    renderBondAccountingStats(rows);
    if (!rows.length) {
      list.innerHTML = allRows.length
        ? '<div class="bank-search-empty">No portfolio files match the current filters.</div>'
        : '<div class="bank-search-empty">The last bond-accounting import did not include any portfolio files.</div>';
      return;
    }
    list.innerHTML = rows.slice(0, 40).map(row => `
      <div class="reports-match-row">
        <div>
          <strong>${escapeHtml(row.bankDisplayName || row.portfolioClientName || row.filename || 'Portfolio file')}</strong>
          <span>${escapeHtml([row.pCode, row.reportDate, row.certNumber ? `Cert ${row.certNumber}` : ''].filter(Boolean).join(' · '))}</span>
        </div>
        <div>
          <strong>${escapeHtml(bondAccountingStatusLabel(row))}</strong>
          <small>${escapeHtml(row.filename || '')}</small>
        </div>
        ${row.storedPath ? `<a class="text-btn" href="${bondAccountingFileUrl(row)}" target="_blank" rel="noopener">Open</a>` : '<span></span>'}
      </div>
    `).join('') + (rows.length > 40 ? `<div class="bank-search-empty">Showing 40 of ${formatNumber(rows.length)} portfolio files.</div>` : '');
  }

  async function loadPeerAnalysisDataset() {
    if (peerAnalysisState.peerData) return peerAnalysisState.peerData;
    const res = await fetch('/api/banks/averaged-series', { cache: 'no-store' });
    peerAnalysisState.peerData = await readBankJson(res);
    return peerAnalysisState.peerData;
  }

  async function searchPeerAnalysisBanks(query, options = {}) {
    const results = document.getElementById('peerAnalysisBankResults');
    const q = String(query || '').trim();
    if (!results) return;
    setPeerAnalysisValidation('');
    if (q.length < 2) {
      results.innerHTML = '';
      if (options.openFirst) setPeerAnalysisValidation('Enter at least two characters to find a bank.');
      return;
    }
    results.innerHTML = '<div class="bank-search-empty">Searching banks...</div>';
    try {
      const res = await fetch(`/api/banks/search?q=${encodeURIComponent(q)}&limit=8`, { cache: 'no-store' });
      const data = await readBankJson(res);
      const rows = data.results || [];
      if (options.openFirst && rows[0]) {
        await loadPeerAnalysisBank(rows[0].id);
        return;
      }
      renderPeerAnalysisBankResults(rows);
    } catch (e) {
      results.innerHTML = `<div class="bank-search-empty">${escapeHtml(e.message)}</div>`;
    }
  }

  function renderPeerAnalysisBankResults(rows) {
    const results = document.getElementById('peerAnalysisBankResults');
    if (!results) return;
    if (!rows.length) {
      results.innerHTML = '<div class="bank-search-empty">No matching banks found.</div>';
      return;
    }
    results.innerHTML = rows.map(row => `
      <button type="button" class="reports-peer-result" data-peer-bank="${escapeHtml(row.id)}">
        <span>
          <strong>${escapeHtml(bankDisplayName(row))}</strong>
          <span>${escapeHtml([row.city, row.state, row.certNumber ? `Cert ${row.certNumber}` : '', row.period].filter(Boolean).join(' · '))}</span>
        </span>
        <span class="text-btn">Select</span>
      </button>
    `).join('');
    results.querySelectorAll('[data-peer-bank]').forEach(btn => {
      btn.addEventListener('click', () => loadPeerAnalysisBank(btn.dataset.peerBank));
    });
  }

  function peerAnalysisSelectedBankId() {
    const bank = peerAnalysisState.bankData && peerAnalysisState.bankData.bank;
    return bank && bank.id ? bank.id : '';
  }

  async function loadPeerAnalysisBank(bankId) {
    const output = document.getElementById('peerAnalysisOutput');
    if (output) output.innerHTML = '<div class="bank-search-empty">Building peer comparison...</div>';
    setPeerAnalysisValidation('');
    try {
      const [bankData, peerData] = await Promise.all([
        fetch(`/api/banks/${encodeURIComponent(bankId)}`, { cache: 'no-store' }).then(readBankJson),
        loadPeerAnalysisDataset()
      ]);
      peerAnalysisState.bankData = bankData;
      peerAnalysisState.peerData = peerData;
      buildPeerAnalysis();
      renderPeerAnalysis();
    } catch (e) {
      peerAnalysisState = { ...peerAnalysisState, bankData: null, rows: [], flags: [], period: '', peerGroup: null };
      if (output) output.innerHTML = `<div class="bank-search-empty">${escapeHtml(e.message)}</div>`;
      const exportBtn = document.getElementById('peerAnalysisExportBtn');
      if (exportBtn) exportBtn.disabled = true;
    }
  }

  function peerMetricMatches(metric, config) {
    if (!metric) return false;
    const label = String(metric.label || '').replace(/^\s*\d+\.\s*/, '');
    return (config.peerLabels || []).some(re => re.test(label));
  }

  function peerSeriesValue(seriesRow, config = {}) {
    if (!seriesRow) return null;
    const order = config.type === 'money'
      ? ['amount', 'value', 'percent']
      : config.type === 'percent'
        ? ['percent', 'value', 'amount']
        : ['value', 'percent', 'amount'];
    for (const field of order) {
      const raw = seriesRow[field];
      if (raw !== null && raw !== '' && Number.isFinite(Number(raw))) return Number(raw);
    }
    return null;
  }

  function peerBankMetricValue(values, config = {}) {
    if (!values || !config.key) return null;
    if (config.denominatorKey) {
      return bankNumericShare(values[config.key], values[config.denominatorKey]);
    }
    const raw = values[config.key];
    if (raw === null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  function buildPeerAnalysis() {
    const bank = peerAnalysisState.bankData && peerAnalysisState.bankData.bank;
    const peerData = peerAnalysisState.peerData || {};
    const latest = bank && Array.isArray(bank.periods) ? bank.periods[0] : null;
    const bankPeriod = latest && latest.period;
    const peerPeriods = Array.isArray(peerData.periods) ? peerData.periods : [];
    const period = peerPeriods.includes(bankPeriod) ? bankPeriod : (peerPeriods[0] || bankPeriod || '');
    const metrics = Array.isArray(peerData.metrics) ? peerData.metrics : [];
    const series = Array.isArray(peerData.series) ? peerData.series : [];
    const values = latest && latest.values ? latest.values : {};

    const rows = PEER_ANALYSIS_METRICS.map(config => {
      const metric = metrics.find(row => peerMetricMatches(row, config));
      const seriesRow = metric ? series.find(row => row.metricKey === metric.key && row.period === period) : null;
      const bankValue = peerBankMetricValue(values, config);
      const peerValue = peerSeriesValue(seriesRow, config);
      const delta = Number.isFinite(bankValue) && Number.isFinite(peerValue) ? bankValue - peerValue : null;
      return {
        ...config,
        bankValue: Number.isFinite(bankValue) ? bankValue : null,
        peerValue: Number.isFinite(peerValue) ? peerValue : null,
        delta,
        peerMetricLabel: metric ? metric.label : '',
        peerMetricKey: metric ? metric.key : ''
      };
    }).filter(row => row.bankValue != null || row.peerValue != null);

    peerAnalysisState.rows = rows;
    peerAnalysisState.period = period;
    peerAnalysisState.peerGroup = Array.isArray(peerData.peerGroups) ? peerData.peerGroups[0] : null;
    peerAnalysisState.flags = buildPeerOpportunityFlags(rows, bank);
  }

  function peerRow(key) {
    return (peerAnalysisState.rows || []).find(row => row.key === key) || {};
  }

  function peerDelta(key) {
    const row = peerRow(key);
    return Number.isFinite(row.delta) ? row.delta : null;
  }

  function buildPeerOpportunityFlags(rows, bank) {
    const flags = [];
    const add = (title, detail) => flags.push({ title, detail });
    const ltd = peerDelta('loansToDeposits');
    const liquid = peerDelta('liquidAssetsToAssets');
    const securities = peerDelta('securitiesToAssets');
    const yieldSec = peerDelta('yieldOnSecurities');
    const nim = peerDelta('netInterestMargin');
    const texas = peerDelta('texasRatio');
    const longAssets = peerDelta('longTermAssetsToAssets');
    const bondCount = bank && bank.bondAccounting && Array.isArray(bank.bondAccounting.portfolios)
      ? bank.bondAccounting.portfolios.length
      : 0;

    if ((ltd != null && ltd > 5) || (liquid != null && liquid < -2)) {
      add('Funding / liquidity call', 'Loans-to-deposits or liquid assets are away from peers; consider funding strategy, brokered CD laddering, or ALM liquidity review.');
    }
    if (securities != null && securities < -3) {
      add('Securities deployment', 'Securities-to-assets is below peers; review cash deployment, agency/corporate inventory, or portfolio accounting needs.');
    }
    if (yieldSec != null && yieldSec < -0.15) {
      add('Portfolio yield review', 'Yield on securities trails peers; use the bond accounting report and current offerings to frame a portfolio review.');
    }
    if (nim != null && nim < -0.15) {
      add('Margin pressure', 'Net interest margin is below peer average; review funding costs, earning-asset mix, and strategy request opportunities.');
    }
    if (texas != null && texas > 2) {
      add('Credit monitoring', 'Texas ratio is above peers; consider CECL analysis or credit-focused follow-up.');
    }
    if (longAssets != null && longAssets > 3) {
      add('ALM / IRR angle', 'Long-term assets are above peers; consider ALM or interest-rate-risk review.');
    }
    if (bondCount) {
      add('Bond accounting attached', `${formatNumber(bondCount)} monthly bond accounting report${bondCount === 1 ? '' : 's'} matched to this bank for portfolio review context.`);
    }
    return flags.slice(0, 6);
  }

  // Opportunity Report ---------------------------------------------------
  // Each rule pulls from per-bank peerDelta_<key> fields produced by
  // /api/banks/map. Weight drives severity ranking; requestType is the
  // strategy queue type the flag tends to map to.
  const OPPORTUNITY_RULES = [
    { id: 'funding-liquidity', title: 'Funding / liquidity call', requestType: 'Bond Swap', weight: 2,
      test: d => (d.loansToDeposits != null && d.loansToDeposits > 5) || (d.liquidAssetsToAssets != null && d.liquidAssetsToAssets < -2),
      detail: 'Loans-to-deposits or liquid assets are away from peers.' },
    { id: 'securities-deployment', title: 'Securities deployment', requestType: 'Bond Swap', weight: 2,
      test: d => d.securitiesToAssets != null && d.securitiesToAssets < -3,
      detail: 'Securities-to-assets is below peers; cash to deploy.' },
    { id: 'portfolio-yield', title: 'Portfolio yield review', requestType: 'Bond Swap', weight: 2,
      test: d => d.yieldOnSecurities != null && d.yieldOnSecurities < -0.15,
      detail: 'Yield on securities trails peers.' },
    { id: 'margin-pressure', title: 'Margin pressure', requestType: 'Bond Swap', weight: 3,
      test: d => d.netInterestMargin != null && d.netInterestMargin < -0.15,
      detail: 'NIM below peer average; funding-cost or asset-mix review.' },
    { id: 'credit-monitoring', title: 'Credit monitoring', requestType: 'CECL Analysis', weight: 3,
      test: d => d.texasRatio != null && d.texasRatio > 2,
      detail: 'Texas ratio above peers.' },
    { id: 'alm-irr', title: 'ALM / IRR angle', requestType: 'THO Report', weight: 2,
      test: d => d.longTermAssetsToAssets != null && d.longTermAssetsToAssets > 3,
      detail: 'Long-term assets above peers.' }
  ];

  const opportunityState = { loading: false, rows: [], generatedAt: null, peerComparison: null, error: null };

  function bankPeerDeltas(bank) {
    return {
      loansToDeposits: bank.peerDelta_loansToDeposits,
      liquidAssetsToAssets: bank.peerDelta_liquidAssetsToAssets,
      securitiesToAssets: bank.peerDelta_securitiesToAssets,
      yieldOnSecurities: bank.peerDelta_yieldOnSecurities,
      netInterestMargin: bank.peerDelta_netInterestMargin,
      texasRatio: bank.peerDelta_texasRatio,
      longTermAssetsToAssets: bank.peerDelta_longTermAssetsToAssets,
      wholesaleFundingReliance: bank.peerDelta_wholesaleFundingReliance,
      efficiencyRatio: bank.peerDelta_efficiencyRatio,
      tier1RiskBasedRatio: bank.peerDelta_tier1RiskBasedRatio,
      nplsToLoans: bank.peerDelta_nplsToLoans
    };
  }

  function evaluateBankOpportunity(bank) {
    const deltas = bankPeerDeltas(bank);
    const flags = [];
    let severity = 0;
    for (const rule of OPPORTUNITY_RULES) {
      if (rule.test(deltas)) {
        flags.push({ id: rule.id, title: rule.title, detail: rule.detail, requestType: rule.requestType, weight: rule.weight });
        severity += rule.weight;
      }
    }
    const topFlag = flags.slice().sort((a, b) => b.weight - a.weight)[0];
    return {
      bankId: bank.id,
      name: bank.displayName || bank.name || '',
      state: bank.state || '',
      city: bank.city || '',
      certNumber: bank.certNumber || '',
      accountStatusLabel: bank.accountStatusLabel || (bank.accountStatus && bank.accountStatus.status) || 'Open',
      isCoverageSaved: Boolean(bank.accountStatus && bank.accountStatus.isCoverageSaved),
      totalAssets: bank.totalAssets,
      deltas,
      flags,
      severity,
      suggestedRequestType: topFlag ? topFlag.requestType : 'Miscellaneous'
    };
  }

  async function runOpportunityScan() {
    if (opportunityState.loading) return;
    const summary = document.getElementById('opportunitySummary');
    const runBtn = document.getElementById('opportunityRunBtn');
    const exportBtn = document.getElementById('opportunityExportBtn');
    const results = document.getElementById('opportunityResults');
    opportunityState.loading = true;
    opportunityState.error = null;
    if (summary) summary.textContent = 'Scanning every bank against peer averages — this can take a few seconds on first run...';
    if (runBtn) { runBtn.disabled = true; runBtn.textContent = 'Scanning...'; }
    if (exportBtn) exportBtn.disabled = true;
    if (results) results.innerHTML = '<div class="bank-search-empty opp-loading">Pulling map dataset and applying peer-gap rules across every bank...</div>';
    try {
      const res = await fetch('/api/banks/map', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Map dataset request failed (HTTP ${res.status}). Restart the portal or re-import the bank workbook, then retry.`);
      const data = await res.json();
      if (!data || !Array.isArray(data.banks)) throw new Error('Map dataset unavailable');
      if (!data.peerComparison) {
        // Distinguish "really not imported" from "imported but cache is stale".
        const status = await fetch('/api/banks/status', { cache: 'no-store' }).then(r => r.json()).catch(() => null);
        if (status && status.averagedSeries && status.averagedSeries.available) {
          throw new Error('Peer averages are imported but the map dataset cache is stale. Restart the portal or re-import the averaged-series workbook to refresh.');
        }
        throw new Error('Peer averages not imported yet — load the averaged-series workbook from the Reports workspace first.');
      }
      opportunityState.peerComparison = data.peerComparison;
      opportunityState.generatedAt = new Date().toISOString();
      opportunityState.rows = data.banks
        .map(evaluateBankOpportunity)
        .filter(row => row.flags.length > 0)
        .sort((a, b) => b.severity - a.severity || Number(b.totalAssets || 0) - Number(a.totalAssets || 0));
      renderOpportunityResults();
    } catch (err) {
      opportunityState.error = err.message;
      if (results) results.innerHTML = `<div class="bank-search-empty">${escapeHtml(err.message)}</div>`;
      if (summary) summary.textContent = err.message;
    } finally {
      opportunityState.loading = false;
      if (runBtn) { runBtn.disabled = false; runBtn.textContent = opportunityState.rows.length ? 'Re-run scan' : 'Run scan'; }
    }
  }

  function filteredOpportunityRows() {
    const minFlags = Number((document.getElementById('opportunityMinFlags') || {}).value || 2);
    const stateFilterRaw = ((document.getElementById('opportunityStateFilter') || {}).value || '').toUpperCase();
    const stateSet = new Set(stateFilterRaw.split(/[\s,]+/).filter(Boolean));
    const savedOnly = Boolean((document.getElementById('opportunitySavedOnly') || {}).checked);
    return opportunityState.rows.filter(row => {
      if (row.flags.length < minFlags) return false;
      if (stateSet.size && !stateSet.has(row.state)) return false;
      if (savedOnly && !row.isCoverageSaved) return false;
      return true;
    });
  }

  function formatOpportunityAssets(value) {
    if (value == null || value === '') return '—';
    const mm = Number(value) / 1000;
    if (!Number.isFinite(mm)) return '—';
    if (Math.abs(mm) >= 1000) return mm.toLocaleString(undefined, { maximumFractionDigits: 0 });
    return mm.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }

  function renderOpportunityResults() {
    const results = document.getElementById('opportunityResults');
    const summary = document.getElementById('opportunitySummary');
    const exportBtn = document.getElementById('opportunityExportBtn');
    if (!results) return;
    if (!opportunityState.rows.length) {
      results.innerHTML = '<div class="bank-search-empty">No banks crossed any opportunity thresholds.</div>';
      if (summary) summary.textContent = 'No flagged banks.';
      if (exportBtn) exportBtn.disabled = true;
      return;
    }
    const visible = filteredOpportunityRows();
    const peer = opportunityState.peerComparison || {};
    const peerLabel = peer.peerGroup ? peer.peerGroup.label : '';
    const peerPeriod = peer.period || '';
    if (summary) {
      summary.textContent = `${formatNumber(visible.length)} of ${formatNumber(opportunityState.rows.length)} flagged · peer ${peerPeriod}${peerLabel ? ` · ${peerLabel.slice(0, 80)}` : ''}`;
    }
    if (exportBtn) exportBtn.disabled = visible.length === 0;
    if (!visible.length) {
      results.innerHTML = '<div class="bank-search-empty">No banks match the current filters.</div>';
      return;
    }
    const top = visible.slice(0, 200);
    results.innerHTML = `
      <table class="opportunity-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Bank</th>
            <th>State</th>
            <th>Status</th>
            <th>Assets ($MM)</th>
            <th>Severity</th>
            <th>Flags</th>
            <th>Suggested</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${top.map((row, idx) => `
            <tr>
              <td>${idx + 1}</td>
              <td><strong>${escapeHtml(row.name)}</strong><br><small>${escapeHtml([row.city, row.certNumber ? `Cert ${row.certNumber}` : ''].filter(Boolean).join(' · '))}</small></td>
              <td>${escapeHtml(row.state)}</td>
              <td>${escapeHtml(row.accountStatusLabel)}</td>
              <td class="num">${escapeHtml(formatOpportunityAssets(row.totalAssets))}</td>
              <td><span class="opp-severity opp-sev-${row.severity >= 6 ? 'high' : row.severity >= 4 ? 'med' : 'low'}">${row.severity}</span></td>
              <td>
                <div class="opp-flag-list">
                  ${row.flags.map(f => `<span class="opp-flag" title="${escapeHtml(f.detail)}">${escapeHtml(f.title)}</span>`).join('')}
                </div>
              </td>
              <td>${escapeHtml(row.suggestedRequestType)}</td>
              <td class="opp-actions">
                <button type="button" class="text-btn" data-opp-open="${escapeHtml(row.bankId)}">Open tear sheet</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ${visible.length > top.length ? `<div class="opp-more">Showing top 200 of ${formatNumber(visible.length)}. Tighten filters to see more.</div>` : ''}
    `;
    results.querySelectorAll('[data-opp-open]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-opp-open');
        goTo('banks');
        if (typeof loadBank === 'function') loadBank(id, { collapseResults: true });
      });
    });
  }

  function exportOpportunityReportCsv() {
    const visible = filteredOpportunityRows();
    if (!visible.length) return;
    const peer = opportunityState.peerComparison || {};
    const rows = [
      ['Rank', 'Bank', 'City', 'State', 'Cert', 'Status', 'Assets ($MM)', 'Severity', 'Flag count', 'Flags', 'Suggested request type']
    ];
    visible.forEach((row, idx) => {
      rows.push([
        idx + 1,
        row.name,
        row.city,
        row.state,
        row.certNumber,
        row.accountStatusLabel,
        formatOpportunityAssets(row.totalAssets),
        row.severity,
        row.flags.length,
        row.flags.map(f => f.title).join(' | '),
        row.suggestedRequestType
      ]);
    });
    const periodTag = peer.period ? `_${peer.period}` : '';
    downloadCsv(`opportunity-report${periodTag}.csv`, rows);
  }
  // ----------------------------------------------------------------------

  function formatPeerValue(value, type) {
    if (value == null) return '—';
    if (type === 'money') return formatCallReportValue(value, 'money');
    if (type === 'percent') return `${formatCallReportValue(value, 'percent')}%`;
    return formatNumber(value);
  }

  function formatPeerDelta(delta, type) {
    if (delta == null) return '—';
    const prefix = delta > 0 ? '+' : '';
    if (type === 'percent') return `${prefix}${delta.toFixed(2)} pts`;
    return `${prefix}${formatNumber(delta)}`;
  }

  function peerSignal(row) {
    if (!row || row.delta == null || row.higherIsBetter == null) return 'Neutral';
    if (Math.abs(row.delta) < 0.01) return 'In line';
    const favorable = row.higherIsBetter ? row.delta > 0 : row.delta < 0;
    return favorable ? 'Favorable' : 'Watch';
  }

  function peerSignalClass(row) {
    const signal = peerSignal(row);
    if (signal === 'Favorable') return 'reports-peer-delta-positive';
    if (signal === 'Watch') return 'reports-peer-delta-negative';
    return '';
  }

  function openPeerAnalysisTearSheet(openStrategyRequest = false) {
    const bank = peerAnalysisState.bankData && peerAnalysisState.bankData.bank;
    if (!bank || !bank.id) return;
    goTo('banks');
    loadBank(bank.id, { collapseResults: true, openStrategyRequest });
  }

  function renderPeerAnalysis() {
    const output = document.getElementById('peerAnalysisOutput');
    const exportBtn = document.getElementById('peerAnalysisExportBtn');
    const bank = peerAnalysisState.bankData && peerAnalysisState.bankData.bank;
    if (!output || !bank) return;
    const latest = bank.periods && bank.periods[0] ? bank.periods[0] : {};
    const values = latest.values || {};
    const peerGroup = peerAnalysisState.peerGroup || {};
    const rows = peerAnalysisState.rows || [];
    const flags = peerAnalysisState.flags || [];
    if (exportBtn) exportBtn.disabled = !rows.length;
    output.innerHTML = `
      <div class="reports-peer-summary">
        <div>
          <strong>${escapeHtml(values.name || bank.summary.displayName || bank.summary.name || 'Selected bank')}</strong>
          <span>${escapeHtml([values.city, values.state, values.certNumber ? `Cert ${values.certNumber}` : '', `Bank period ${latest.period || '—'}`, `Peer period ${peerAnalysisState.period || '—'}`].filter(Boolean).join(' · '))}</span>
          <span>${escapeHtml(peerGroup.label || 'Current averaged-series peer group')}</span>
        </div>
        <div class="reports-peer-actions">
          <button type="button" class="small-btn" data-peer-open-tearsheet>Open Tear Sheet</button>
          <button type="button" class="small-btn" data-peer-start-strategy>Start Strategy</button>
        </div>
      </div>
      ${flags.length ? `
        <div class="reports-peer-flags">
          ${flags.map(flag => `
            <article class="reports-peer-flag">
              <strong>${escapeHtml(flag.title)}</strong>
              <span>${escapeHtml(flag.detail)}</span>
            </article>
          `).join('')}
        </div>
      ` : '<div class="bank-search-empty">No opportunity flags from the current metric set.</div>'}
      ${rows.length ? `<div class="reports-peer-table-wrap">
        <table class="reports-peer-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Bank</th>
              <th>Peer</th>
              <th>Delta</th>
              <th>Signal</th>
              <th>Section</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                <td>${escapeHtml(row.label)}</td>
                <td>${escapeHtml(formatPeerValue(row.bankValue, row.type))}</td>
                <td>${escapeHtml(formatPeerValue(row.peerValue, row.type))}</td>
                <td class="${peerSignalClass(row)}">${escapeHtml(formatPeerDelta(row.delta, row.type))}</td>
                <td>${escapeHtml(peerSignal(row))}</td>
                <td>${escapeHtml(row.section)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>` : '<div class="bank-search-empty">No shared metrics were found between this bank and the imported peer workbook.</div>'}
    `;
    output.querySelector('[data-peer-open-tearsheet]')?.addEventListener('click', () => openPeerAnalysisTearSheet(false));
    output.querySelector('[data-peer-start-strategy]')?.addEventListener('click', () => openPeerAnalysisTearSheet(true));
  }

  function resetPeerAnalysisBuilder({ keepPeerData = true } = {}) {
    const peerData = keepPeerData ? peerAnalysisState.peerData : null;
    peerAnalysisState = { bankData: null, peerData, rows: [], flags: [], period: '', peerGroup: null };
    const input = document.getElementById('peerAnalysisBankSearchInput');
    const results = document.getElementById('peerAnalysisBankResults');
    const output = document.getElementById('peerAnalysisOutput');
    const exportBtn = document.getElementById('peerAnalysisExportBtn');
    if (input) input.value = '';
    if (results) results.innerHTML = '';
    if (output) output.innerHTML = '<div class="bank-search-empty">Select a bank to generate a peer comparison.</div>';
    if (exportBtn) exportBtn.disabled = true;
    setPeerAnalysisValidation('');
  }

  function formatImportedDate(iso) {
    if (!iso) return 'recently';
    try {
      return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      return 'recently';
    }
  }

  function setupHome() {
    const strategyOpen = document.querySelector('[data-home-strategy-open]');
    const strategyInput = document.getElementById('homeStrategyBankSearch');
    const strategyButton = document.getElementById('homeStrategyBankSearchBtn');
    if (strategyOpen && strategyInput) {
      strategyOpen.addEventListener('click', () => strategyInput.focus());
    }
    if (strategyInput) {
      let t = null;
      strategyInput.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => searchHomeStrategyBanks(strategyInput.value), 180);
      });
      strategyInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          searchHomeStrategyBanks(strategyInput.value, { openFirst: true });
        }
      });
    }
    if (strategyButton) {
      strategyButton.addEventListener('click', () => searchHomeStrategyBanks(strategyInput ? strategyInput.value : '', { openFirst: true }));
    }
  }

  async function searchHomeStrategyBanks(query, options = {}) {
    const results = document.getElementById('homeStrategyBankResults');
    const q = String(query || '').trim();
    if (!results) return;
    if (q.length < 2) {
      results.innerHTML = '';
      return;
    }
    results.innerHTML = '<div class="bank-search-empty">Searching banks...</div>';
    try {
      const res = await fetch(`/api/banks/search?q=${encodeURIComponent(q)}&limit=5`, { cache: 'no-store' });
      const data = await readBankJson(res);
      const rows = data.results || [];
      if (options.openFirst && rows[0]) {
        openBankStrategyRequest(rows[0].id);
        return;
      }
      renderHomeStrategyBankResults(rows);
    } catch (e) {
      results.innerHTML = `<div class="bank-search-empty">${escapeHtml(e.message)}</div>`;
    }
  }

  function renderHomeStrategyBankResults(rows) {
    const results = document.getElementById('homeStrategyBankResults');
    if (!results) return;
    if (!rows.length) {
      results.innerHTML = '<div class="bank-search-empty">No matching banks found.</div>';
      return;
    }
    results.innerHTML = rows.map(row => `
      <button type="button" class="home-strategy-result" data-home-strategy-bank="${escapeHtml(row.id)}">
        <strong>${escapeHtml(bankDisplayName(row))}</strong>
        <span>${escapeHtml([row.city, row.state, row.certNumber ? `Cert ${row.certNumber}` : ''].filter(Boolean).join(' · '))}</span>
      </button>
    `).join('');
    results.querySelectorAll('[data-home-strategy-bank]').forEach(btn => {
      btn.addEventListener('click', () => openBankStrategyRequest(btn.dataset.homeStrategyBank));
    });
  }

  function openBankStrategyRequest(bankId) {
    if (!bankId) return;
    goTo('banks');
    loadBank(bankId, { collapseResults: true, openStrategyRequest: true });
  }

  function setupBankSearch() {
    const input = document.getElementById('bankSearchInput');
    const btn = document.getElementById('bankSearchBtn');
    const upload = document.getElementById('bankWorkbookInput');
    const statusUpload = document.getElementById('bankStatusWorkbookInput');
    const averagedSeriesUpload = document.getElementById('averagedSeriesWorkbookInput');
    const clearRecent = document.getElementById('clearRecentBanksBtn');
    const savedFilter = document.getElementById('bankSavedFilterInput');
    const accountCoverageFilter = document.getElementById('bankAccountCoverageFilterInput');
    const accountCoverageStatus = document.getElementById('bankAccountCoverageStatusFilter');
    const accountCoverageService = document.getElementById('bankAccountCoverageServiceFilter');
    const accountCoverageSort = document.getElementById('bankAccountCoverageSort');
    setupBankWorkspaceTabs();
    if (input) {
      let t = null;
      input.addEventListener('focus', () => {
        if (!input.value.trim()) showBankRecentDropdown();
      });
      input.addEventListener('input', () => {
        clearTimeout(t);
        if (input.value.trim()) hideBankRecentDropdown();
        else showBankRecentDropdown();
        t = setTimeout(() => searchBanks(input.value), 180);
      });
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          hideBankRecentDropdown();
          searchBanks(input.value);
        } else if (e.key === 'Escape') {
          hideBankRecentDropdown();
          clearBankSearchResults();
        }
      });
    }
    if (btn) btn.addEventListener('click', () => {
      hideBankRecentDropdown();
      searchBanks(input ? input.value : '');
    });
    const profile = document.getElementById('bankProfile');
    if (profile) profile.addEventListener('click', (e) => {
      if (e.target.closest('[data-bank-focus-search]') && input) {
        input.focus();
        showBankRecentDropdown();
      }
    });
    if (upload) upload.addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      if (file) uploadBankWorkbook(file);
    });
    if (statusUpload) statusUpload.addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      if (file) uploadBankStatusWorkbook(file);
    });
    if (averagedSeriesUpload) averagedSeriesUpload.addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      if (file) uploadAveragedSeriesWorkbook(file);
    });
    if (clearRecent) clearRecent.addEventListener('click', clearRecentBanks);
    document.addEventListener('click', event => {
      if (!event.target.closest('.bank-search-panel')) hideBankRecentDropdown();
    });
    if (savedFilter) savedFilter.addEventListener('input', renderSavedBanks);
    [accountCoverageFilter, accountCoverageStatus, accountCoverageService, accountCoverageSort].filter(Boolean).forEach(el => {
      let t = null;
      el.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(loadAccountCoverageAccounts, 180);
      });
      el.addEventListener('change', loadAccountCoverageAccounts);
    });
    document.querySelectorAll('[data-account-queue]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (accountCoverageStatus) accountCoverageStatus.value = btn.dataset.accountQueue || '';
        if (accountCoverageService) accountCoverageService.value = '';
        loadAccountCoverageAccounts();
      });
    });
    renderRecentBanks();
    loadSavedBanks();
    loadAccountCoverageAccounts();
  }

  function setupStrategies() {
    const search = document.getElementById('strategySearchInput');
    const type = document.getElementById('strategyTypeFilter');
    const archive = document.getElementById('strategyArchiveFilter');
    const refresh = document.getElementById('strategyRefreshBtn');
    if (search) search.addEventListener('input', renderStrategyBoard);
    if (type) type.addEventListener('change', renderStrategyBoard);
    if (archive) archive.addEventListener('change', loadStrategies);
    if (refresh) refresh.addEventListener('click', loadStrategies);
    setupSwapBuilderTab();
  }

  // ============ Bond Swap tab ============

  const swapBuilderState = {
    eligibleBanks: null,
    bankId: null,
    bankName: '',
    suggestion: null,
    suggestionLoading: false,
    knobs: null,          // desk overrides for the Portfolio Filtering screen; null = server defaults
    screenCands: [],      // full screened candidate list backing the blotter + CSV
    recentLoading: false,
    view: 'home',         // 'home' or 'editor'
    proposalId: null,
    record: null,
    saveTimer: null,
    pendingPatches: new Map(),
    // CUSIP picker caches — populated when entering the editor for a bank.
    holdingsByCusip: new Map(),     // sell-side: bank's parsed portfolio
    inventoryByCusip: new Map()     // buy-side: today's daily package
  };

  function setupSwapBuilderTab() {
    const picker = document.getElementById('swapBankSelect');
    const handleBankSelection = () => {
      const id = picker.value || null;
      if (id === swapBuilderState.bankId) return;
      setSwapSelectedBank(id);
      swapBuilderState.view = 'home';
      swapBuilderState.proposalId = null;
      swapBuilderState.record = null;
      replaceHashParams('bond-swap', { bank: id || '' });
      if (id) loadSuggestedSwapsForBank(id);
      else renderSwapBuilderEmpty();
      loadRecentSwapProposals(id);
    };
    if (picker) {
      picker.addEventListener('change', handleBankSelection);
      picker.addEventListener('input', handleBankSelection);
      picker.addEventListener('keydown', event => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const max = picker.options.length - 1;
        picker.selectedIndex = Math.max(0, Math.min(max, picker.selectedIndex + direction));
        handleBankSelection();
      });
    }
    const body = document.getElementById('swapBuilderBody');
    if (body && picker) {
      body.addEventListener('click', event => {
        if (!event.target.closest('[data-swap-pick-bank]')) return;
        picker.focus();
        if (typeof picker.showPicker === 'function') {
          try { picker.showPicker(); } catch (e) { /* not user-activated; focus is enough */ }
        }
      });
    }
  }

  function setSwapSelectedBank(bankId, fallbackName = '') {
    const id = bankId ? String(bankId) : null;
    const select = document.getElementById('swapBankSelect');
    swapBuilderState.bankId = id;
    if (select) {
      select.value = id || '';
      const selected = select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
      if (id && selected && selected.value === id) {
        swapBuilderState.bankName = selected.textContent || fallbackName || id;
      } else {
        swapBuilderState.bankName = id ? (fallbackName || swapBuilderState.bankName || id) : '';
      }
    } else {
      swapBuilderState.bankName = id ? (fallbackName || swapBuilderState.bankName || id) : '';
    }
  }

  // Entry point fired by goTo() when the Bond Swap page activates. Reads the
  // bank / proposal deep-link params off the #bond-swap hash and restores the
  // matching view (suggested-swaps home, or an open proposal in the editor).
  function enterBondSwapPage() {
    const params = hashParamsForPage('bond-swap');
    const proposalFromHash = params.get('proposal') || '';
    const bankFromHash = params.get('bank') || swapBuilderState.bankId || '';
    const banksLoaded = !!swapBuilderState.eligibleBanks;
    if (bankFromHash) setSwapSelectedBank(bankFromHash);
    if (!banksLoaded) loadSwapEligibleBanks();
    if (proposalFromHash && swapBuilderState.proposalId !== proposalFromHash) {
      openProposalInEditor(proposalFromHash);
    } else if (!proposalFromHash) {
      swapBuilderState.view = 'home';
      swapBuilderState.proposalId = null;
      swapBuilderState.record = null;
      if (bankFromHash) {
        if (banksLoaded) {
          loadSuggestedSwapsForBank(bankFromHash);
          loadRecentSwapProposals(bankFromHash);
        }
      } else {
        renderSwapBuilderEmpty();
        loadRecentSwapProposals(null);
      }
    }
  }

  async function loadSwapEligibleBanks() {
    const select = document.getElementById('swapBankSelect');
    if (!select) return;
    try {
      const res = await fetch('/api/swap-proposals/eligible-banks', { cache: 'no-store' });
      const data = await res.json();
      swapBuilderState.eligibleBanks = Array.isArray(data.banks) ? data.banks : [];
      select.innerHTML = '<option value="">Choose a bank with a bond-accounting file…</option>'
        + swapBuilderState.eligibleBanks.map(b =>
            `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)} · ${escapeHtml(b.city || '')}${b.state ? ', ' + escapeHtml(b.state) : ''} · ${b.isSubchapterS ? 'Sub-S' : 'C-corp'}</option>`
          ).join('');
      // Restore selection from hash if present
      const params = hashParamsForPage('bond-swap');
      const bankFromHash = params.get('bank') || '';
      const proposalFromHash = params.get('proposal') || '';
      if (bankFromHash && swapBuilderState.eligibleBanks.some(b => b.id === bankFromHash)) {
        setSwapSelectedBank(bankFromHash);
        // Only push the home-suggested view if we're not also restoring a
        // specific proposal — otherwise openProposalInEditor's render gets
        // race-overwritten by the suggested-swap load.
        if (!proposalFromHash && swapBuilderState.view !== 'editor') {
          loadSuggestedSwapsForBank(bankFromHash);
        }
        loadRecentSwapProposals(bankFromHash);
      } else if (swapBuilderState.bankId && swapBuilderState.eligibleBanks.some(b => b.id === swapBuilderState.bankId)) {
        setSwapSelectedBank(swapBuilderState.bankId);
      }
    } catch (err) {
      select.innerHTML = `<option value="">Failed to load banks (${escapeHtml(err.message || 'error')})</option>`;
    }
  }

  function emptyStateHtml({ icon = '', title = '', hint = '', action = '' } = {}) {
    return `
      <div class="empty-state">
        ${icon ? `<div class="empty-state-icon" aria-hidden="true">${icon}</div>` : ''}
        ${title ? `<h3>${escapeHtml(title)}</h3>` : ''}
        ${hint ? `<p>${escapeHtml(hint)}</p>` : ''}
        ${action ? `<div class="empty-state-action">${action}</div>` : ''}
      </div>`;
  }

  function renderSwapBuilderEmpty(message) {
    const body = document.getElementById('swapBuilderBody');
    if (!body) return;
    // An explicit message means an error/status — keep the plain inline line.
    if (message) {
      body.innerHTML = `<div class="bank-search-empty">${escapeHtml(message)}</div>`;
      return;
    }
    body.innerHTML = emptyStateHtml({
      icon: '⇄',
      title: 'No bank selected',
      hint: 'Choose a bank with a bond-accounting file on record to see suggested swaps, or build your own proposal by CUSIP.',
      action: '<button type="button" class="small-btn" data-swap-pick-bank>Choose a bank</button>'
    });
  }

  async function loadSuggestedSwapsForBank(bankId) {
    const body = document.getElementById('swapBuilderBody');
    if (!body || !bankId) return;
    swapBuilderState.suggestionLoading = true;
    body.innerHTML = `<div class="bank-search-empty">Loading portfolio ideas for ${escapeHtml(swapBuilderState.bankName || bankId)}&hellip;</div>`;
    try {
      const params = new URLSearchParams({ bankId });
      const k = swapBuilderState.knobs || {};
      // state key → query param. Blank/undefined falls back to the server default.
      const knobMap = { reinvestRate: 'reinvestRate', taxRate: 'taxRate', cof: 'cof', bq: 'bq', maxPctLoss: 'maxPctLoss', maxDollarLoss: 'maxDollarLoss', minPar: 'minPar' };
      for (const [sk, qp] of Object.entries(knobMap)) {
        if (k[sk] != null && k[sk] !== '') params.set(qp, k[sk]);
      }
      const res = await fetch('/api/swap-proposals/suggested?' + params.toString(), { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (swapBuilderState.bankId !== bankId || swapBuilderState.view !== 'home') return;
      if (!res.ok) {
        // A server error must not masquerade as "this bank has no ideas" — the
        // rep would loosen knobs against a screen that can never populate.
        renderSwapBuilderEmpty('Could not load portfolio ideas: ' + (data.error || ('HTTP ' + res.status)));
        return;
      }
      swapBuilderState.suggestion = data;
      swapBuilderState.screenCands = Array.isArray(data.kept) ? data.kept : [];
      renderSuggestedSwaps(data);
    } catch (err) {
      renderSwapBuilderEmpty('Failed to load portfolio ideas: ' + (err.message || 'error'));
    } finally {
      swapBuilderState.suggestionLoading = false;
    }
  }

  function renderSuggestedSwaps(data) {
    const body = document.getElementById('swapBuilderBody');
    if (!body) return;
    if (!data || data.notice) {
      body.innerHTML = `
        <div class="swap-bank-banner">
          <div>
            <strong>${escapeHtml(data && data.bankName || swapBuilderState.bankName)}</strong>
            <span>${escapeHtml(data && data.notice || 'No bond-accounting file on record.')}</span>
          </div>
          <button type="button" class="small-btn" data-swap-manual="1">Build manual proposal</button>
        </div>`;
      bindBuildManual(body);
      return;
    }
    const kept = Array.isArray(data.kept) ? data.kept : [];
    const dropped = Array.isArray(data.dropped) ? data.dropped : [];
    const cards = kept.slice(0, 12);
    const teLabel = data.isSubchapterS ? 'Sub-S · TE @ 29.6%' : 'C-corp · TE @ 21%';
    body.innerHTML = `
      <div class="swap-bank-banner">
        <div>
          <strong>${escapeHtml(data.bankName || swapBuilderState.bankName)}</strong>
          <span>Holdings on file: ${escapeHtml(String(data.holdingsTotalPositions || 0))} positions
            (${escapeHtml(data.holdingsReportDate || '—')}) · ${escapeHtml(teLabel)}</span>
        </div>
        <div class="swap-banner-actions">
          <button type="button" class="small-btn" data-swap-manual="1">Build manual proposal</button>
        </div>
      </div>
      ${renderSwapKnobs(data)}
      ${renderSwapHero(data)}
      ${renderSwapPackages(data)}
      ${renderSwapSnapshot(data)}
      ${renderSwapSectorBars(data)}
      ${renderSwapRunoffTable(data)}
      <h3 class="swap-section-head">Top swap ideas <span class="swap-count">${kept.length}</span></h3>
      ${cards.length
        ? `<div class="swap-card-grid">${cards.map((c, i) => renderSwapCandidateCardForTab(c, i)).join('')}</div>`
        : `<div class="bank-search-empty">No positions clear the current screen. Loosen the loss thresholds or lower the minimum position size above.</div>`}
      ${kept.length ? renderSwapBlotter(data, kept) : ''}
      ${renderSwapFindings(data)}
      ${dropped.length ? renderDroppedSwapsSection(dropped) : ''}`;
    bindBuildManual(body);
    bindSwapKnobs(body);
    bindSwapBlotter(body);
    body.querySelectorAll('[data-build-from-candidate]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.buildFromCandidate);
        const candidate = (data.kept || [])[idx];
        if (candidate) buildProposalFromCandidate(data.bankId, candidate);
      });
    });
    bindSwapPackages(body, data);
    const droppedToggle = body.querySelector('[data-toggle-dropped]');
    if (droppedToggle) {
      droppedToggle.addEventListener('click', () => {
        const list = body.querySelector('.swap-dropped-list');
        if (!list) return;
        const open = list.hasAttribute('hidden') ? false : true;
        list.toggleAttribute('hidden');
        droppedToggle.textContent = open ? `Show hard-dropped (${dropped.length})` : `Hide hard-dropped (${dropped.length})`;
      });
    }
  }

  function bindBuildManual(scope) {
    const btn = scope.querySelector('[data-swap-manual]');
    if (!btn) return;
    btn.addEventListener('click', () => createManualSwapProposal());
  }

  // ---- Portfolio Filtering knobs (tax / COF / BQ / reinvest target / loss budget) ----
  function renderSwapKnobs(data) {
    const k = data.knobs || {};
    const bq = Number(k.bqFactor);
    // A single flat reinvest target the rep sets (defaults to 5.00%).
    const reinvVal = k.reinvestRatePct != null ? Number(k.reinvestRatePct).toFixed(2) : '5.00';
    return `
      <div class="swap-knobs">
        <div class="knob"><label>Tax rate %</label><input type="number" step="1" min="0" max="99" id="kbTax" value="${escapeHtml(String(k.taxRatePct ?? 21))}"></div>
        <div class="knob"><label>Cost of funds %</label><input type="number" step="0.05" min="0" id="kbCof" value="${escapeHtml(String(k.cofPct ?? 1.5))}"></div>
        <div class="knob"><label>Muni BQ</label><select id="kbBq">
          <option value="0.20"${bq !== 1 ? ' selected' : ''}>Bank-Qualified</option>
          <option value="1.00"${bq === 1 ? ' selected' : ''}>Non-BQ</option></select></div>
        <div class="knob"><label>Reinvest YTW %</label><input type="number" step="0.05" min="0" max="15" id="kbReinv" value="${escapeHtml(reinvVal)}"></div>
        <div class="knob"><label>Max % loss</label><input type="number" step="0.5" min="0" id="kbMaxPct" value="${escapeHtml(String(k.maxPctLoss ?? 4))}"></div>
        <div class="knob"><label>Max $ loss (000)</label><input type="number" step="1" min="0" id="kbMaxDol" value="${escapeHtml(String(k.maxDollarLossK ?? 10))}"></div>
        <div class="knob"><label>Min position (000)</label><input type="number" step="25" min="0" id="kbMinPar" value="${escapeHtml(String(k.minParK ?? 100))}"></div>
        <div class="knob"><button type="button" class="small-btn primary" data-rerun-knobs>Re-run ideas</button></div>
        <div class="swap-knobs-note">Drop-in Portfolio Filtering screen: every idea is <b>sell &rarr; reinvest the proceeds at the target rate</b> (a real same-sector buy is shown when one beats the held bond). Filters: % loss within max, $ loss under max, position &ge; min, nothing maturing inside 12 months, then names yielding <b>below the ${Number(reinvVal).toFixed(2)}% reinvest target</b> — exempt munis compared on a tax-equivalent basis via <code>(YTW&nbsp;&minus;&nbsp;COF&middot;t&middot;q)/(1&minus;t)</code> (C-corp BQ q=0.20, Sub-S BQ q=0, non-BQ q=1.00). Ranked lowest-yield first. Set min position to 0 to include odd-lots.</div>
      </div>`;
  }

  function bindSwapKnobs(scope) {
    const rerun = scope.querySelector('[data-rerun-knobs]');
    if (!rerun) return;
    const val = id => { const el = document.getElementById(id); if (!el) return undefined; const v = String(el.value).trim(); return v === '' ? undefined : v; };
    rerun.addEventListener('click', () => {
      const bqEl = document.getElementById('kbBq');
      swapBuilderState.knobs = {
        taxRate: val('kbTax'), cof: val('kbCof'), bq: bqEl ? bqEl.value : undefined,
        reinvestRate: val('kbReinv'), maxPctLoss: val('kbMaxPct'),
        maxDollarLoss: val('kbMaxDol'), minPar: val('kbMinPar')
      };
      loadSuggestedSwapsForBank(swapBuilderState.bankId);
    });
  }

  // ---- Opportunity hero ----
  function renderSwapHero(data) {
    const h = data.hero || {};
    const m = (lab, num, sub) => `<div class="swap-hero-m"><div class="lab">${lab}</div><div class="num">${num}</div>${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ''}</div>`;
    return `<div class="swap-hero"><div class="swap-hero-hk">Opportunity Summary</div><div class="swap-hero-grid">
      ${m('Executable Volume', compactCurrency(h.executableVolume), `${Number(h.count || 0)} swap tickets`)}
      ${m('Added Annual Income', compactCurrency(h.addedAnnualIncome), `vs ${compactCurrency(h.realizedLoss)} realized loss`)}
      ${m('Blended Breakeven', h.blendedBreakevenYears == null ? '—' : Number(h.blendedBreakevenYears).toFixed(1) + ' yrs', 'loss ÷ income pickup')}
      ${m('Reinvest Pipeline', h.reinvestPipeline12 == null ? '—' : compactCurrency(h.reinvestPipeline12), 'runoff to redeploy, 12mo')}
    </div></div>`;
  }

  // ---- Auto-suggested multi-sell packages ----
  // Sell several underearning lots (possibly across sectors) into one best-fit
  // buy. Only packages that clear net-income, breakeven, and horizon gates reach
  // here (server-side), so this is a "here's a restructuring worth doing" block.
  function renderSwapPackages(data) {
    const packages = Array.isArray(data.packages) ? data.packages : [];
    if (!packages.length) return '';
    return `
      <h3 class="swap-section-head">Multi-bond swap packages <span class="swap-count">${packages.length}</span></h3>
      <div class="swap-pkg-grid">
        ${packages.map((pkg, i) => renderSwapPackageCard(pkg, i)).join('')}
      </div>`;
  }

  function renderSwapPackageCard(pkg, idx) {
    const offering = pkg.offering || {};
    const sells = Array.isArray(pkg.sells) ? pkg.sells : [];
    const cap = pkg.breakevenCapMonths || 24;
    const buyYield = Number(offering.yield) || 0;
    const econ = computePackageEconomics(sells, buyYield, cap); // all lots selected initially
    const buyTxt = offering.generic
      ? `Reinvest at ${buyYield.toFixed(2)}% target`
      : `${escapeHtml(offering.label || offering.cusip || 'buy')} @ ${buyYield.toFixed(2)}%`;
    const fit = offering.fitSummary ? `<div class="swap-pkg-fit">${escapeHtml(offering.fitSummary)}</div>` : '';
    const sectorsTxt = (pkg.sectorsSold || []).join(' · ');
    const sellRows = sells.map((s, mi) => {
      const h = s.held || {};
      return `<tr data-mi="${mi}">
        <td class="ck"><input type="checkbox" class="swap-pkg-cand" data-pkg="${idx}" data-mi="${mi}" checked></td>
        <td class="cusip">${escapeHtml(h.cusip || '—')}</td>
        <td>${escapeHtml((h.description || '').slice(0, 30))}</td>
        <td class="num">${compactCurrency(h.par)}</td>
        <td class="num">${h.effYield == null ? '—' : Number(h.effYield).toFixed(2) + '%'}</td>
        <td class="num${(h.gainLoss || 0) < 0 ? ' neg' : ''}">${compactCurrency(h.gainLoss)}</td>
        <td class="num">${h.monthsToMaturity == null ? '—' : Math.round(h.monthsToMaturity) + 'mo'}</td>
      </tr>`;
    }).join('');
    return `
      <div class="swap-pkg-card" data-pkg="${idx}" data-pkg-buy-yield="${buyYield}" data-pkg-cap="${cap}">
        <header class="swap-pkg-head">
          <div>
            <strong>${escapeHtml(pkg.title || `Sell ${sells.length} lots`)}</strong>
            <span class="swap-pkg-sub">${sectorsTxt ? escapeHtml(sectorsTxt) + ' → ' : ''}${buyTxt}</span>
          </div>
          <button type="button" class="small-btn primary" data-build-from-package="${idx}">Build proposal (${sells.length})</button>
        </header>
        <div class="swap-pkg-warn" data-pkg-warn="${idx}" hidden></div>
        <div class="swap-pkg-stats" data-pkg-stats="${idx}">${swapPackageStatsHtml(econ, cap)}</div>
        ${fit}
        <table class="swap-pkg-sells">
          <thead><tr>
            <th class="ck"><label class="sa-mini"><input type="checkbox" class="swap-pkg-all" data-pkg="${idx}" checked> All</label></th>
            <th>CUSIP</th><th>Description</th><th class="num">Par</th><th class="num">Eff yld</th><th class="num">G/L</th><th class="num">Mat</th>
          </tr></thead>
          <tbody>${sellRows}</tbody>
        </table>
      </div>`;
  }

  // Client-side mirror of swapMath.summarizeReinvestPackage — recomputes the
  // package economics live as the rep checks/unchecks lots. Same summable math:
  // income given up + realized G/L + proceeds are per-lot sums; income gained =
  // Σproceeds × buy yield; breakeven = Σloss ÷ (pickup ÷ 12).
  function computePackageEconomics(members, buyYieldPct, capMonths) {
    const list = (members || []).filter(Boolean);
    const cap = Number(capMonths) || 24;
    const buyYield = Number(buyYieldPct) || 0;
    if (!list.length) return { count: 0, passes: false, reasons: ['no lots selected'] };
    let proceeds = 0, givenUp = 0, realized = 0, par = 0, marketValue = 0, wH = 0, hW = 0, minMonths = Infinity;
    for (const c of list) {
      const e = c.economics || {}, h = c.held || {};
      const p = Number(e.replacementPar) || Number(h.marketValue) || 0;
      proceeds += p;
      givenUp += Number(e.annualIncomeGivenUp) || 0;
      realized += Number(e.realizedGainLoss != null ? e.realizedGainLoss : h.gainLoss) || 0;
      par += Number(h.par) || 0;
      marketValue += Number(h.marketValue) || 0;
      const hy = Number(e.horizonYears);
      if (hy > 0 && p > 0) { wH += hy * p; hW += p; }
      const mtm = Number(h.monthsToMaturity);
      if (Number.isFinite(mtm)) minMonths = Math.min(minMonths, mtm);
    }
    if (minMonths === Infinity) minMonths = null;
    const horizon = hW ? wH / hW : 1;
    const annualBuyIncome = proceeds * buyYield / 100;
    const pickup = annualBuyIncome - givenUp;
    const lossToEarnBack = realized < 0 ? -realized : 0;
    const breakevenMonths = lossToEarnBack > 0 ? (pickup > 0 ? lossToEarnBack / (pickup / 12) : null) : 0;
    const netBenefitToHorizon = pickup * horizon + realized;
    const reasons = [];
    if (!(pickup > 0)) reasons.push('no net annual income pickup');
    if (breakevenMonths === null) reasons.push('realized loss is never recouped');
    if (breakevenMonths != null && breakevenMonths > cap) reasons.push(`breakeven over the ${cap}mo cap`);
    if (breakevenMonths != null && minMonths != null && breakevenMonths > minMonths) reasons.push('a sold bond matures before breakeven');
    if (!(netBenefitToHorizon > 0)) reasons.push('net benefit to horizon is not positive');
    return {
      count: list.length, passes: reasons.length === 0, reasons,
      par, marketValue, proceeds, realizedGainLoss: realized,
      annualIncomePickup: pickup, breakevenMonths,
      netBenefitToHorizon, horizonYears: horizon, minMonthsToMaturity: minMonths
    };
  }

  function swapPackageStatsHtml(e, cap) {
    const beMonths = e.breakevenMonths;
    const beTxt = beMonths == null ? '—' : (beMonths <= 0 ? 'immediate' : Number(beMonths).toFixed(1) + ' mo');
    const beBad = beMonths == null || beMonths > cap;
    const matBad = beMonths != null && e.minMonthsToMaturity != null && beMonths > e.minMonthsToMaturity;
    const stat = (lab, val, neg) => `<div class="swap-pkg-stat"><span class="lab">${lab}</span><span class="val${neg ? ' neg' : ''}">${val}</span></div>`;
    return stat('Added annual income', compactCurrency(e.annualIncomePickup), !(e.annualIncomePickup > 0))
      + stat('Realized loss', compactCurrency(e.realizedGainLoss), (e.realizedGainLoss || 0) < 0)
      + stat('Breakeven', beTxt + (beMonths != null && beMonths > 0 ? ` (cap ${cap}mo)` : ''), beBad)
      + stat('Earliest maturity', e.minMonthsToMaturity == null ? '—' : Math.round(e.minMonthsToMaturity) + ' mo', matBad)
      + stat('Net benefit @' + (e.horizonYears == null ? '—' : Number(e.horizonYears).toFixed(1) + 'y'), compactCurrency(e.netBenefitToHorizon), !(e.netBenefitToHorizon > 0))
      + stat('Proceeds to redeploy', compactCurrency(e.proceeds));
  }

  // Wire each package card's checkboxes + select-all so the rep can drop CUSIPs
  // and watch the economics update; "Build proposal" uses only the checked lots.
  function bindSwapPackages(scope, data) {
    const packages = Array.isArray(data.packages) ? data.packages : [];
    scope.querySelectorAll('.swap-pkg-card').forEach(card => {
      const idx = Number(card.dataset.pkg);
      const pkg = packages[idx];
      if (!pkg) return;
      const buyYield = Number(card.dataset.pkgBuyYield) || 0;
      const cap = Number(card.dataset.pkgCap) || 24;
      const boxes = () => Array.from(card.querySelectorAll('.swap-pkg-cand'));
      const checkedMembers = () => boxes().filter(cb => cb.checked).map(cb => pkg.sells[Number(cb.dataset.mi)]).filter(Boolean);

      const recompute = () => {
        boxes().forEach(cb => { const tr = cb.closest('tr'); if (tr) tr.classList.toggle('off', !cb.checked); });
        const members = checkedMembers();
        const econ = computePackageEconomics(members, buyYield, cap);
        const statsEl = card.querySelector('[data-pkg-stats]');
        if (statsEl) statsEl.innerHTML = swapPackageStatsHtml(econ, cap);
        const warnEl = card.querySelector('[data-pkg-warn]');
        if (warnEl) {
          if (members.length >= 2 && !econ.passes) {
            warnEl.hidden = false;
            warnEl.textContent = '⚠ Edited package no longer clears the desk gates: ' + econ.reasons.join('; ') + '. You can still build it — review before sending.';
          } else { warnEl.hidden = true; warnEl.textContent = ''; }
        }
        const all = card.querySelector('.swap-pkg-all');
        if (all) { all.checked = members.length === boxes().length; all.indeterminate = members.length > 0 && members.length < boxes().length; }
        const build = card.querySelector('[data-build-from-package]');
        if (build) {
          build.disabled = members.length < 2;
          build.textContent = members.length < 2 ? 'Select ≥2 lots' : `Build proposal (${members.length})`;
        }
      };

      boxes().forEach(cb => cb.addEventListener('change', recompute));
      const all = card.querySelector('.swap-pkg-all');
      if (all) all.addEventListener('change', () => { boxes().forEach(cb => { cb.checked = all.checked; }); recompute(); });
      const build = card.querySelector('[data-build-from-package]');
      if (build) build.addEventListener('click', () => {
        const members = checkedMembers();
        if (members.length < 2) { showToast('Select at least 2 lots for a package', true); return; }
        buildProposalFromPackage(data.bankId, Object.assign({}, pkg, { sells: members }));
      });
      recompute();
    });
  }

  // ---- Portfolio snapshot cells ----
  function renderSwapSnapshot(data) {
    const p = data.profile || {}, r = data.runoff || {};
    const ub = (p.totalGainLoss || 0) < 0;
    const cell = (kk, v, neg) => `<div class="swap-snap-cell"><div class="k">${kk}</div><div class="v${neg ? ' neg' : ''}">${v}</div></div>`;
    return `<div class="swap-snap">
      ${cell('Book Value', compactCurrency(p.totalBook))}
      ${cell('Market Value', compactCurrency(p.totalMarket))}
      ${cell('Unrealized G/L', compactCurrency(p.totalGainLoss), ub)}
      ${cell('% of Book', p.pctOfBook == null ? '—' : Number(p.pctOfBook).toFixed(2) + '%', ub)}
      ${cell('Positions', p.positions == null ? '—' : p.positions)}
      ${cell('WAvg Coupon', p.wCoupon == null ? '—' : Number(p.wCoupon).toFixed(2) + '%')}
      ${cell('WAL', p.wWal == null ? '—' : Number(p.wWal).toFixed(1) + 'y')}
      ${cell('Eff. Duration', p.wDuration == null ? '—' : Number(p.wDuration).toFixed(1))}
      ${cell('Maturing ≤6mo', compactCurrency(r.mat6))}
      ${cell('Proj. Runoff ≤6mo', r.hasCashflow ? compactCurrency(r.run6) : '—')}
    </div>`;
  }

  // ---- Sector composition bars ----
  function renderSwapSectorBars(data) {
    const secs = (data.profile && data.profile.sectors) || [];
    if (!secs.length) return '';
    const max = Math.max.apply(null, secs.map(s => s.pctPar || 0)) || 1;
    return `<h3 class="swap-section-head">Sector composition</h3>
      <div class="swap-bars">${secs.map(s => `<div class="swap-barrow">
        <span class="lab">${escapeHtml(s.sector)}</span>
        <span class="track"><span class="fill" style="width:${((s.pctPar || 0) / max * 100).toFixed(1)}%"></span></span>
        <span class="val">${compactCurrency(s.par)} · ${Number(s.pctPar || 0).toFixed(1)}%</span>
      </div>`).join('')}</div>`;
  }

  // ---- Maturity & call runoff table ----
  function renderSwapRunoffTable(data) {
    const r = data.runoff || {};
    const row = (lbl, mat, run) => `<tr><td>${lbl}</td><td class="r">${compactCurrency(mat)}</td>
      <td class="r">${r.hasCashflow ? compactCurrency(run) : '—'}</td>
      <td class="r">${r.hasCashflow ? compactCurrency((run || 0) - (mat || 0)) : '—'}</td></tr>`;
    return `<h3 class="swap-section-head">Maturity &amp; call runoff</h3>
      <table class="swap-runoff-tbl">
        <tr><th>Horizon</th><th class="r">Maturities</th><th class="r">Projected runoff</th><th class="r">Calls + paydowns add'l</th></tr>
        ${row('Within 6 months', r.mat6, r.run6)}
        ${row('Within 12 months', r.mat12, r.run12)}
        ${row('Within 24 months', r.mat24, r.run24)}
      </table>
      <p class="swap-runoff-note">Maturities reflect final stated maturity dates. Projected runoff is read from the workbook's own <b>cashflow-data</b> sheet (base scenario) — already incorporating calls, scheduled amortization, and maturities.</p>`;
  }

  // ---- Interactive swap blotter (select names → live package totals → CSV) ----
  function renderSwapBlotter(data, kept) {
    const top = kept.slice(0, 40);
    const rows = top.map((c, i) => {
      const glPctNeg = (c.held.gainLossPct || 0) < 0;
      const glNeg = (c.held.gainLoss || 0) < 0;
      const checked = c.pickupVsReinvest != null && c.pickupVsReinvest > 0 ? ' checked' : '';
      return `<tr data-ci="${i}">
        <td class="ck"><input type="checkbox" class="swap-cand" data-ci="${i}"${checked}></td>
        <td class="cu">${escapeHtml(c.held.cusip || '')}</td>
        <td>${escapeHtml((c.held.description || '').slice(0, 26))}</td>
        <td>${escapeHtml(c.sector || '')}</td>
        <td class="r">${compactCurrency(c.held.par)}</td>
        <td class="r">${escapeHtml(c.held.maturity || '—')}</td>
        <td class="r">${c.held.effYield == null ? '—' : Number(c.held.effYield).toFixed(2) + '%'}${c.held.isExemptMuni ? '<span class="te-star">*</span>' : ''}</td>
        <td class="r ${glPctNeg ? 'negc' : 'posc'}">${c.held.gainLossPct == null ? '—' : Number(c.held.gainLossPct).toFixed(2) + '%'}</td>
        <td class="r ${glNeg ? 'negc' : 'posc'}">${compactCurrency(c.held.gainLoss)}</td>
        <td class="r posc">${c.pickupVsReinvest == null ? '—' : '+' + Number(c.pickupVsReinvest).toFixed(2) + '%'}</td>
        <td class="r">${c.reinvestBreakevenYears == null ? '—' : Number(c.reinvestBreakevenYears).toFixed(1) + 'y'}</td>
      </tr>`;
    }).join('');
    const more = kept.length > top.length ? `<p class="swap-blotter-more">Showing the ${top.length} highest-priority of ${kept.length} candidates; CSV exports all selected.</p>` : '';
    return `<h3 class="swap-section-head">Swap blotter <span class="swap-count">${kept.length}</span></h3>
      <div class="swap-toolbar">
        <label class="sa"><input type="checkbox" id="swapSelAll" checked data-toggle-all> Select all shown</label>
        <button type="button" class="small-btn primary" data-build-selected-proposal>Build proposal from selected</button>
        <button type="button" class="small-btn" data-export-csv>Export selected to CSV</button>
        <span class="te-note">Yield* = book YTW (taxable) / tax-equivalent YTW (exempt munis<span class="te-star">*</span>).</span>
      </div>
      <div class="swap-blotter-scroll"><table class="swap-blotter-tbl">
        <tr><th class="ck"></th><th>CUSIP</th><th>Description</th><th>Sector</th><th class="r">Par</th><th class="r">Maturity</th><th class="r">Yield*</th><th class="r">% Loss</th><th class="r">$ G/L</th><th class="r">Pickup</th><th class="r">Breakeven</th></tr>
        ${rows}
      </table></div>${more}
      <div class="swap-package"><div class="bh">Selected swap package</div><div class="bg" id="swapPackage"></div></div>`;
  }

  function bindSwapBlotter(scope) {
    const pkg = scope.querySelector('#swapPackage');
    if (!pkg) return;
    scope.querySelectorAll('input.swap-cand').forEach(cb => cb.addEventListener('change', updateSwapPackage));
    const selAll = scope.querySelector('[data-toggle-all]');
    if (selAll) selAll.addEventListener('change', () => {
      scope.querySelectorAll('input.swap-cand').forEach(cb => { cb.checked = selAll.checked; });
      updateSwapPackage();
    });
    const exp = scope.querySelector('[data-export-csv]');
    if (exp) exp.addEventListener('click', exportSwapCsv);
    const build = scope.querySelector('[data-build-selected-proposal]');
    if (build) build.addEventListener('click', buildProposalFromSelectedSwaps);
    updateSwapPackage();
  }

  function selectedSwapCands() {
    const cands = swapBuilderState.screenCands || [];
    return [...document.querySelectorAll('input.swap-cand:checked')].map(cb => cands[+cb.dataset.ci]).filter(Boolean);
  }

  function updateSwapPackage() {
    const el = document.getElementById('swapPackage');
    if (!el) return;
    document.querySelectorAll('input.swap-cand').forEach(cb => { const tr = cb.closest('tr'); if (tr) tr.classList.toggle('off', !cb.checked); });
    const sel = selectedSwapCands();
    const sum = f => sel.reduce((a, c) => a + (Number(f(c)) || 0), 0);
    const par = sum(c => c.held.par);
    const proceeds = sum(c => c.held.marketValue);
    const loss = sum(c => c.held.gainLoss);
    const lift = sum(c => (c.pickupVsReinvest > 0 ? c.addedAnnualIncome : 0));
    const be = lift > 0 ? Math.abs(loss) / lift : null;
    const cell = (lab, num, neg) => `<div class="b"><div class="lab">${lab}</div><div class="num${neg ? ' neg' : ''}">${num}</div></div>`;
    el.innerHTML = cell('Names', sel.length)
      + cell('Sell Par', compactCurrency(par))
      + cell('Proceeds to Reinvest', compactCurrency(proceeds))
      + cell('Realized Loss', compactCurrency(loss), true)
      + cell('Added Annual Income', compactCurrency(lift))
      + cell('Blended Breakeven', be == null ? '—' : be.toFixed(1) + ' yrs');
    const buildBtn = document.querySelector('[data-build-selected-proposal]');
    if (buildBtn) {
      buildBtn.disabled = sel.length === 0;
      buildBtn.textContent = sel.length > 1
        ? `Build proposal from selected (${sel.length})`
        : 'Build proposal from selected';
    }
  }

  function exportSwapCsv() {
    const sel = selectedSwapCands();
    if (!sel.length) { showToast('No names selected to export', true); return; }
    const head = ['CUSIP', 'Description', 'Sector', 'Maturity', 'Par', 'Book Px', 'Mkt Px', 'Book Yield', 'Eff Yield (TEY if exempt)', '% G/L', '$ G/L', 'Market Value', 'Buy CUSIP', 'Buy Yield', 'Pickup vs Reinvest %', 'Reinvest Breakeven (yrs)'];
    const lines = [head.join(',')].concat(sel.map(c => [
      c.held.cusip, c.held.description, c.sector, c.held.maturity, c.held.par, c.held.bookPrice,
      c.held.marketPrice, c.held.bookYield, c.held.effYield, c.held.gainLossPct, c.held.gainLoss, c.held.marketValue,
      c.offering.cusip, c.offering.yield, c.pickupVsReinvest, c.reinvestBreakevenYears
    ].map(csvEscape).join(',')));
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (swapBuilderState.bankName || 'portfolio').replace(/\s+/g, '_') + '_swap_candidates.csv';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  // ---- Portfolio-specific findings (server-composed prose) ----
  function renderSwapFindings(data) {
    const fs = data.findings || [];
    if (!fs.length) return '';
    return `<h3 class="swap-section-head">Portfolio-specific ideas</h3>`
      + fs.map(f => `<div class="swap-finding sev-${escapeHtml(f.sev)}">
        <div class="ft"><span class="swap-badge b-${escapeHtml(f.sev)}">${escapeHtml(f.badge)}</span><h4>${escapeHtml(f.title)}</h4></div>
        <p>${f.body}</p>
      </div>`).join('');
  }

  // Why a held bond surfaced as a swap idea. These map the server `tags`.
  const SWAP_TAG_LABELS = {
    'below-reinvest': 'Below reinvest',
    'small-loss': 'Small loss',
    'small-gain': 'Small gain',
    'loss-harvest': 'Loss harvest',
    'yield-pickup': 'Yield pickup'
  };

  function renderSwapTags(tags) {
    if (!Array.isArray(tags) || !tags.length) return '';
    return `<div class="swap-card-tags">${tags.map(t =>
      `<span class="swap-tag swap-tag-${escapeHtml(t)}">${escapeHtml(SWAP_TAG_LABELS[t] || t)}</span>`
    ).join('')}</div>`;
  }

  function renderSwapCandidateCardForTab(c, index) {
    const econ = c.economics || {};
    const warnings = (c.rule && c.rule.warnings) || [];
    const heldTitle = [c.held.cusip, c.held.description].filter(Boolean).join(' · ') || 'Current holding';
    const glPct = c.held.gainLossPct;
    const glLabel = glPct == null ? '' : ` (${glPct > 0 ? '+' : ''}${Number(glPct).toFixed(1)}%)`;
    const beYrs = c.reinvestBreakevenYears != null
      ? Number(c.reinvestBreakevenYears).toFixed(1) + ' yr'
      : (econ.breakevenMonths == null ? '—' : (Number(econ.breakevenMonths) / 12).toFixed(1) + ' yr');
    const matched = c.offering && !c.offering.generic;
    const fitBits = [];
    if (c.reinvestRate != null) {
      const effTxt = c.held.isExemptMuni ? `held TE ${Number(c.held.effYield).toFixed(2)}%` : `held ${Number(c.held.bookYield).toFixed(2)}%`;
      let line = `${effTxt} → reinvest ${Number(c.reinvestRate).toFixed(2)}%`;
      if (matched) line += ` · available today: buy ${Number(c.offering.yield).toFixed(2)}%`;
      fitBits.push(line);
    } else if (c.offering.fitSummary) {
      fitBits.push(c.offering.fitSummary);
    }
    const sellBits = [
      c.held.par ? compactCurrency(c.held.par) + ' par' : '',
      `${Number(c.held.bookYield).toFixed(2)}% book`,
      c.held.isExemptMuni && c.held.effYield != null ? `${Number(c.held.effYield).toFixed(2)}% TE` : '',
      c.held.maturity ? 'matures ' + c.held.maturity : ''
    ].filter(Boolean).join(' · ');
    return `
      <article class="swap-card">
        <header>
          <span class="swap-card-num">Swap ${index + 1}</span>
          <strong>${escapeHtml(c.sector || 'Portfolio')}</strong>
        </header>
        ${renderSwapTags(c.tags)}
        <div class="swap-card-legs">
          <div><span>Sell</span><strong>${escapeHtml(heldTitle)}</strong><em>${escapeHtml(sellBits)}</em></div>
          <div><span>Buy</span><strong>${escapeHtml(c.offering.label || 'Reinvest at target')}</strong><em>${escapeHtml(matched ? `${Number(c.offering.yield).toFixed(3)}% YTW · CUSIP ${c.offering.cusip || '—'}` : `${Number(c.offering.yield).toFixed(2)}% target · pick the buy`)}</em></div>
        </div>
        ${fitBits.length ? `<div class="swap-fit-note">${escapeHtml(fitBits.join(' · '))}</div>` : ''}
        <dl class="swap-card-metrics">
          <div><dt>Pickup vs reinvest</dt><dd>${c.pickupVsReinvest == null ? '—' : '+' + Number(c.pickupVsReinvest).toFixed(2) + '%'}</dd></div>
          <div><dt>Added income/yr</dt><dd>${compactCurrency(c.addedAnnualIncome)}</dd></div>
          <div><dt>Breakeven</dt><dd>${beYrs}</dd></div>
          <div><dt>Gain/Loss</dt><dd>${compactCurrency(c.held.gainLoss)}${glLabel}</dd></div>
          <div><dt>Buy pickup vs book</dt><dd>${c.yieldPickupVsBook == null ? '—' : '+' + Number(c.yieldPickupVsBook).toFixed(2) + '%'}</dd></div>
          <div><dt>Net benefit</dt><dd>${compactCurrency(econ.netBenefitToHorizon)}</dd></div>
        </dl>
        ${warnings.length ? `<ul class="swap-card-warnings">${warnings.map(w => `<li>${escapeHtml(w.message)}</li>`).join('')}</ul>` : ''}
        <div class="swap-card-actions">
          <button type="button" class="small-btn" data-build-from-candidate="${index}">Build proposal from this</button>
        </div>
      </article>`;
  }

  function renderDroppedSwapsSection(dropped) {
    return `
      <h3 class="swap-section-head">
        <button type="button" class="swap-dropped-toggle" data-toggle-dropped>Show hard-dropped (${dropped.length})</button>
      </h3>
      <ul class="swap-dropped-list" hidden>
        ${dropped.map(d => `
          <li>
            <strong>${escapeHtml(d.held.cusip || '—')}</strong>
            <span>${escapeHtml(d.held.description || '')}</span>
            <em>${escapeHtml(d.rule && d.rule.hardReason || 'matures before breakeven')}</em>
          </li>`).join('')}
      </ul>`;
  }

  function compactCurrency(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}MM`;
    if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
    return `${sign}$${Math.round(abs)}`;
  }

  function holdingIndexByCusip(positions) {
    const map = new Map();
    for (const row of positions || []) {
      if (row && row.cusip) map.set(String(row.cusip).toUpperCase(), row);
    }
    return map;
  }

  function candidateReinvestTarget(candidate) {
    const suggestion = swapBuilderState.suggestion || {};
    const knobs = suggestion.knobs || {};
    const values = [
      candidate && candidate.reinvestRate,
      suggestion.reinvestTarget,
      knobs.reinvestRatePct
    ];
    for (const value of values) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  }

  function sellLegPayloadFromCandidate(candidate, sellRow, sourceDate) {
    const held = candidate.held || {};
    return {
      side: 'sell',
      cusip: held.cusip,
      description: sellRow.description || held.description,
      sector: sellRow.sector || candidate.sector,
      coupon: sellRow.coupon,
      maturity: sellRow.maturity || held.maturity,
      callDate: sellRow.callDate,
      par: sellRow.par || held.par,
      bookPrice: sellRow.bookPrice || held.bookPrice,
      marketPrice: sellRow.marketPrice || held.marketPrice,
      bookYieldYtm: sellRow.bookYieldYtm ?? held.bookYield,
      bookYieldYtw: sellRow.bookYieldYtw ?? held.bookYield,
      marketYieldYtm: sellRow.marketYieldYtm,
      marketYieldYtw: sellRow.marketYieldYtw,
      modifiedDuration: sellRow.modifiedDuration ?? held.effDuration,
      averageLife: sellRow.averageLife ?? held.wal,
      sourceKind: 'holdings',
      sourceRef: 'bond-accounting',
      sourceDate: sourceDate || ''
    };
  }

  function buyLegPayloadFromCandidate(candidate, sellRow) {
    const offering = candidate.offering || {};
    return {
      side: 'buy',
      cusip: offering.cusip,
      description: offering.label,
      sector: candidate.sector,
      coupon: offering.coupon,
      maturity: offering.maturity,
      callDate: offering.callDate,
      par: candidate.economics && candidate.economics.replacementPar || sellRow.par || candidate.held.par,
      marketPrice: offering.price || 100,
      marketYieldYtw: offering.yield,
      sourceKind: offering.generic ? 'manual' : 'daily-package',
      sourceRef: offering.sourceRef || (offering.generic ? 'reinvest-target' : 'daily-package'),
      sourceDate: offering.generic ? '' : new Date().toISOString().slice(0, 10)
    };
  }

  function packageBuyLegPayload(candidates) {
    const sum = fn => candidates.reduce((total, candidate) => total + (Number(fn(candidate)) || 0), 0);
    const target = candidateReinvestTarget(candidates[0]);
    const par = sum(c => c.held && c.held.marketValue) || sum(c => c.held && c.held.par);
    const targetText = target == null ? '' : ` at ${target.toFixed(2)}% target`;
    return {
      side: 'buy',
      description: `Reinvest selected proceeds${targetText}`,
      sector: 'Portfolio reinvestment',
      coupon: target,
      par,
      marketPrice: 100,
      marketYieldYtw: target,
      sourceKind: 'manual',
      sourceRef: `${candidates.length} selected Portfolio Idea Engine ideas`
    };
  }

  async function addSwapLegToProposal(id, payload, label) {
    const res = await fetch(`/api/swap-proposals/${id}/legs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || `Could not add ${label}`);
    }
  }

  async function buildProposalFromCandidate(bankId, candidate) {
    return buildProposalFromCandidates(bankId, [candidate]);
  }

  // Seed a proposal from an auto-suggested multi-sell package. Every member LOT
  // becomes its own sell leg — unlike the blotter's buildProposalFromCandidates,
  // we do NOT dedup by CUSIP, because a bank can hold several tax-lots of the
  // same CUSIP (bought at different prices) and the package sells each one. The
  // package's targeted best-fit buy seeds the single buy leg, sized to combined
  // proceeds.
  async function buildProposalFromPackage(bankId, pkg) {
    const sells = (pkg && Array.isArray(pkg.sells) ? pkg.sells : []).filter(c => c && c.held);
    if (!bankId || sells.length < 2) return;
    try {
      const createRes = await fetch('/api/swap-proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankId,
          title: `Bond Swap — ${swapBuilderState.bankName || bankId}`,
          notes: `Seeded from suggested multi-bond package (${sells.length} lots → ${(pkg.offering && pkg.offering.label) || 'reinvest target'}).`
        })
      });
      const created = await createRes.json();
      if (!createRes.ok) throw new Error(created.error || 'Could not create proposal');
      const id = created.proposal.id;

      // Holdings give full sell-side metadata (coupon, call date). Group rows by
      // CUSIP so multiple lots of one CUSIP each get paired to a distinct row.
      const holdingsRes = await fetch('/api/swap-proposals/holdings?bankId=' + encodeURIComponent(bankId), { cache: 'no-store' });
      const holdings = holdingsRes.ok ? await holdingsRes.json() : { positions: [] };
      const lotsByCusip = new Map();
      for (const row of holdings.positions || []) {
        const key = String(row.cusip || '').toUpperCase();
        if (!lotsByCusip.has(key)) lotsByCusip.set(key, []);
        lotsByCusip.get(key).push({ row, used: false });
      }
      const matchLot = held => {
        const lots = lotsByCusip.get(String(held.cusip || '').toUpperCase()) || [];
        const close = (a, b) => a != null && b != null && Math.abs(Number(a) - Number(b)) <= Math.max(1, Math.abs(Number(b)) * 0.01);
        // Prefer the unused lot whose par + book price match this lot, else any
        // unused lot of the CUSIP, else nothing (seed straight from held).
        let lot = lots.find(l => !l.used && close(l.row.par, held.par) && close(l.row.bookPrice, held.bookPrice))
          || lots.find(l => !l.used);
        if (lot) { lot.used = true; return lot.row; }
        return {};
      };

      for (const candidate of sells) {
        await addSwapLegToProposal(id, sellLegPayloadFromCandidate(candidate, matchLot(candidate.held), holdings.reportDate), 'a sell leg');
      }
      await addSwapLegToProposal(id, packageBuyLegFromOffering(pkg.offering, sells), 'the package buy leg');

      showToast(`Proposal ${id} created with ${sells.length} sell legs`);
      await openProposalInEditor(id);
      loadRecentSwapProposals(bankId);
    } catch (err) {
      showToast('Could not build package proposal: ' + (err.message || err), true);
    }
  }

  // Buy-leg payload for a package, sized to the combined proceeds. Uses the
  // package's concrete best-fit offering when present; otherwise falls back to
  // the generic reinvest-at-target leg.
  function packageBuyLegFromOffering(offering, candidates) {
    const sumProceeds = candidates.reduce((total, c) =>
      total + (Number(c.economics && c.economics.replacementPar)
        || Number(c.held && c.held.marketValue) || 0), 0);
    if (!offering || offering.generic) {
      const generic = packageBuyLegPayload(candidates);
      if (sumProceeds) generic.par = Math.round(sumProceeds);
      return generic;
    }
    return {
      side: 'buy',
      cusip: offering.cusip,
      description: offering.label,
      sector: offering.sector,
      coupon: offering.coupon,
      maturity: offering.maturity,
      callDate: offering.callDate,
      par: Math.round(sumProceeds) || undefined,
      marketPrice: offering.price || 100,
      marketYieldYtw: offering.yield,
      sourceKind: 'daily-package',
      sourceRef: offering.sourceRef || 'daily-package',
      sourceDate: new Date().toISOString().slice(0, 10)
    };
  }

  async function buildProposalFromSelectedSwaps() {
    const bankId = swapBuilderState.bankId;
    const candidates = selectedSwapCands();
    if (!bankId) return showToast('Pick a bank first', true);
    if (!candidates.length) return showToast('No swap ideas selected', true);
    return buildProposalFromCandidates(bankId, candidates);
  }

  async function buildProposalFromCandidates(bankId, candidates, packageOffering = null) {
    const unique = [];
    const seen = new Set();
    for (const candidate of candidates || []) {
      if (!candidate || !candidate.held) continue;
      const key = String(candidate.held.cusip || unique.length).toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(candidate);
    }
    if (!bankId || !unique.length) return;
    const packageMode = unique.length > 1;
    try {
      const createRes = await fetch('/api/swap-proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankId,
          title: `Bond Swap — ${swapBuilderState.bankName || bankId}`,
          notes: packageMode
            ? `Seeded from selected swap package (${unique.length} sell positions).`
            : `Seeded from suggested swap (${unique[0].held.cusip || ''} → ${(unique[0].offering && unique[0].offering.cusip) || ''}).`
        })
      });
      const created = await createRes.json();
      if (!createRes.ok) throw new Error(created.error || 'Could not create proposal');
      const id = created.proposal.id;

      // Look up the bank's holdings row so we get full sell-side metadata
      const holdingsRes = await fetch('/api/swap-proposals/holdings?bankId=' + encodeURIComponent(bankId), { cache: 'no-store' });
      if (!holdingsRes.ok) throw new Error('Could not load holdings for the sell leg');
      const holdings = await holdingsRes.json();
      const holdingsByCusip = holdingIndexByCusip(holdings.positions || []);

      for (const candidate of unique) {
        const sellRow = holdingsByCusip.get(String(candidate.held.cusip || '').toUpperCase()) || {};
        await addSwapLegToProposal(id, sellLegPayloadFromCandidate(candidate, sellRow, holdings.reportDate), 'the sell leg');
      }

      if (packageMode) {
        const buyLeg = packageOffering
          ? packageBuyLegFromOffering(packageOffering, unique)
          : packageBuyLegPayload(unique);
        await addSwapLegToProposal(id, buyLeg, 'the package buy leg');
      } else {
        const candidate = unique[0];
        const sellRow = holdingsByCusip.get(String(candidate.held.cusip || '').toUpperCase()) || {};
        await addSwapLegToProposal(id, buyLegPayloadFromCandidate(candidate, sellRow), 'the buy leg');
      }

      showToast(packageMode
        ? `Proposal ${id} created with ${unique.length} sell legs`
        : `Proposal ${id} created with seeded legs`);
      await openProposalInEditor(id);
      loadRecentSwapProposals(bankId);
    } catch (err) {
      showToast('Could not build proposal: ' + (err.message || err), true);
    }
  }

  async function createManualSwapProposal() {
    const bankId = swapBuilderState.bankId;
    if (!bankId) return showToast('Pick a bank first', true);
    try {
      const res = await fetch('/api/swap-proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankId,
          title: `Bond Swap — ${swapBuilderState.bankName || bankId}`,
          notes: 'Manual proposal — legs entered by rep.'
        })
      });
      const created = await res.json();
      if (!res.ok) throw new Error(created.error || 'Could not create proposal');
      showToast(`Draft ${created.proposal.id} created — add sell + buy legs`);
      await openProposalInEditor(created.proposal.id);
      loadRecentSwapProposals(bankId);
    } catch (err) {
      showToast('Could not create proposal: ' + (err.message || err), true);
    }
  }

  // ============ Inline editor ============

  async function openProposalInEditor(id) {
    if (!id) return;
    swapBuilderState.view = 'editor';
    swapBuilderState.proposalId = id;
    replaceHashParams('bond-swap', {
      bank: swapBuilderState.bankId || '',
      proposal: id
    });
    try {
      const res = await fetch('/api/swap-proposals/' + encodeURIComponent(id), { cache: 'no-store' });
      const record = await res.json();
      if (!res.ok) throw new Error(record.error || 'Failed to load proposal');
      if (hashParamsForPage('bond-swap').get('proposal') !== id) return;
      swapBuilderState.record = record;
      const recordBankId = record.proposal.bankId || swapBuilderState.bankId || '';
      if (recordBankId) {
        setSwapSelectedBank(recordBankId);
        replaceHashParams('bond-swap', {
          bank: recordBankId,
          proposal: id
        });
        loadRecentSwapProposals(recordBankId);
      }
      // Prime the picker caches in parallel so the rep can type a CUSIP
      // the moment the editor renders.
      const bankId = record.proposal.bankId;
      primeSwapPickerCaches(bankId).catch(() => {});
      renderProposalEditor(record);
    } catch (err) {
      renderSwapBuilderEmpty('Could not load proposal: ' + (err.message || err));
    }
  }

  async function primeSwapPickerCaches(bankId) {
    const [hRes, iRes] = await Promise.all([
      bankId ? fetch('/api/swap-proposals/holdings?bankId=' + encodeURIComponent(bankId), { cache: 'no-store' }) : Promise.resolve(null),
      fetch('/api/swap-proposals/inventory', { cache: 'no-store' })
    ]);
    swapBuilderState.holdingsByCusip = new Map();
    if (hRes && hRes.ok) {
      const h = await hRes.json();
      for (const p of (h.positions || [])) {
        if (p && p.cusip) swapBuilderState.holdingsByCusip.set(String(p.cusip).toUpperCase(), p);
      }
    }
    swapBuilderState.inventoryByCusip = new Map();
    if (iRes && iRes.ok) {
      const inv = await iRes.json();
      for (const item of (inv.inventory || [])) {
        if (item && item.cusip) swapBuilderState.inventoryByCusip.set(String(item.cusip).toUpperCase(), item);
      }
    }
    // Datalists may have been rendered already with no options — refresh
    // them in place so the dropdown populates without a full re-render.
    refreshPickerDatalists();
  }

  function refreshPickerDatalists() {
    const sellList = document.getElementById('swapHoldingsDatalist');
    if (sellList) {
      sellList.innerHTML = Array.from(swapBuilderState.holdingsByCusip.values()).slice(0, 500).map(p =>
        `<option value="${escapeHtml(p.cusip)}">${escapeHtml(p.cusip + ' · ' + (p.description || '') + (p.maturity ? ' · ' + p.maturity : ''))}</option>`
      ).join('');
    }
    const buyList = document.getElementById('swapInventoryDatalist');
    if (buyList) {
      buyList.innerHTML = Array.from(swapBuilderState.inventoryByCusip.values()).slice(0, 500).map(p =>
        `<option value="${escapeHtml(p.cusip)}">${escapeHtml(p.cusip + ' · ' + (p.description || '') + ' · ' + (p.sector || ''))}</option>`
      ).join('');
    }
  }

  function exitEditorToHome() {
    swapBuilderState.view = 'home';
    swapBuilderState.proposalId = null;
    swapBuilderState.record = null;
    if (window.fbbsBreadcrumb) window.fbbsBreadcrumb.clearDetail();
    replaceHashParams('bond-swap', { bank: swapBuilderState.bankId || '' });
    if (swapBuilderState.bankId) loadSuggestedSwapsForBank(swapBuilderState.bankId);
    else renderSwapBuilderEmpty();
    loadRecentSwapProposals(swapBuilderState.bankId);
  }

  function renderProposalEditor(record) {
    const body = document.getElementById('swapBuilderBody');
    if (!body || !record || !record.proposal) return;
    const { proposal, legs, computedSummary } = record;
    const isDraft = proposal.status === 'draft';
    const sells = legs.filter(l => l.side === 'sell');
    const buys = legs.filter(l => l.side === 'buy');
    body.innerHTML = `
      <div class="swap-editor">
        <header class="swap-editor-head">
          <button type="button" class="text-btn" data-editor-back>&larr; Back to suggested</button>
          <div class="swap-editor-title">
            <strong>${escapeHtml(proposal.id)}</strong>
            <span>${escapeHtml(proposal.title || 'Bond Swap')}</span>
            ${renderProposalStatusBadge(proposal)}
          </div>
          <div class="swap-editor-actions">
            <a class="small-btn" href="/api/swap-proposals/${encodeURIComponent(proposal.id)}/render" target="_blank" rel="noopener">View / Print</a>
            ${isDraft ? `
              <button type="button" class="small-btn" data-editor-cancel>Cancel</button>
              <button type="button" class="publish-btn" data-editor-send>Send proposal</button>
            ` : ''}
            ${proposal.status === 'sent' ? `
              <button type="button" class="publish-btn" data-editor-execute>Mark executed</button>
            ` : ''}
            ${(proposal.status === 'sent' || proposal.status === 'executed' || proposal.status === 'cancelled') ? `
              <button type="button" class="small-btn" data-editor-clone>Revise (new draft)</button>
            ` : ''}
          </div>
        </header>
        <div id="swapSendIssues" class="swap-send-issues" role="alert" hidden></div>
        <div class="swap-editor-meta">
          <label class="swap-editor-title-field"><span>Title</span><input type="text" data-editor-field="title" value="${escapeHtml(proposal.title || '')}" title="${escapeHtml(proposal.title || '')}" ${isDraft ? '' : 'readonly'}></label>
          <label><span>Settle date</span><input type="date" data-editor-field="settleDate" value="${escapeHtml(proposal.settleDate || '')}" ${isDraft ? '' : 'readonly'}></label>
          <label><span>Horizon (yr)</span><input type="number" step="0.25" min="0.25" max="30" data-editor-field="horizonYears" value="${proposal.horizonYears == null ? '' : proposal.horizonYears}" ${isDraft ? '' : 'readonly'}></label>
          <label><span>Tax rate (%)</span><input type="number" step="0.1" min="0" max="100" data-editor-field="taxRate" value="${proposal.taxRate == null ? '' : proposal.taxRate}" ${isDraft ? '' : 'readonly'}></label>
          <label class="swap-editor-notes"><span>Notes</span><textarea data-editor-field="notes" rows="2" ${isDraft ? '' : 'readonly'}>${escapeHtml(proposal.notes || '')}</textarea></label>
        </div>
        ${renderLegSideTable('sell', sells, isDraft)}
        ${renderLegSideTable('buy', buys, isDraft)}
        ${legs.some(l => l.derived && Object.keys(l.derived).length)
          ? `<p class="swap-derived-legend">Fields in <em>italic blue</em> were computed from price + coupon + maturity — the source workbook didn't supply them.</p>`
          : ''}
        ${renderEditorSummary(computedSummary, proposal)}
        <datalist id="swapHoldingsDatalist"></datalist>
        <datalist id="swapInventoryDatalist"></datalist>
      </div>`;
    if (window.fbbsBreadcrumb) window.fbbsBreadcrumb.setDetail('bond-swap', proposal.id);
    refreshPickerDatalists();
    bindEditorHandlers(record);
  }

  function renderProposalStatusBadge(p) {
    const map = {
      draft: ['draft', 'Draft'],
      sent: ['sent', 'Sent'],
      executed: ['executed', 'Executed'],
      cancelled: ['cancelled', 'Cancelled']
    };
    const [cls, label] = map[p.status] || ['draft', p.status];
    return `<span class="swap-status-pill ${cls}">${escapeHtml(label)}</span>`;
  }

  // min/max mirror swapMath.validateLegInput (server) so the browser flags an
  // out-of-range value before the PATCH round-trip; the server stays the hard
  // gate. Keep these in sync with LEG_NUMERIC_BOUNDS in swap-math.js.
  const LEG_INPUTS = [
    { key: 'cusip', label: 'CUSIP', type: 'text', size: 10 },
    { key: 'description', label: 'Description', type: 'text', size: 26 },
    { key: 'coupon', label: 'Cpn', type: 'number', step: '0.001', min: 0, max: 30 },
    { key: 'maturity', label: 'Maturity', type: 'date' },
    { key: 'par', label: 'Par', type: 'number', step: '1', min: 0, minExclusive: true },
    { key: 'bookPrice', label: 'Bk Px', type: 'number', step: '0.001', min: 0, minExclusive: true, max: 1000, secondary: true },
    { key: 'marketPrice', label: 'Mkt Px', type: 'number', step: '0.001', min: 0, minExclusive: true, max: 1000 },
    { key: 'bookYieldYtm', label: 'Bk YTM %', type: 'number', step: '0.001', min: -10, max: 50, secondary: true },
    { key: 'marketYieldYtw', label: 'Mkt YTW %', type: 'number', step: '0.001', min: -10, max: 50 },
    { key: 'averageLife', label: 'WAL', type: 'number', step: '0.01', min: 0, max: 100, secondary: true }
  ];

  function legIsUnfilled(leg) {
    if (!leg) return true;
    const cusip = String(leg.cusip || '').trim();
    const par = Number(leg.par);
    return !cusip && (!Number.isFinite(par) || par === 0);
  }

  function editorLegMarketValue(leg) {
    if (!leg) return null;
    const direct = Number(leg.marketValue);
    if (Number.isFinite(direct)) return direct;
    const par = Number(leg.par);
    const price = Number(leg.marketPrice);
    return Number.isFinite(par) && Number.isFinite(price) ? par * price / 100 : null;
  }

  function editorLegHeaderMetrics(rows) {
    let par = 0;
    let marketValue = 0;
    let hasMarketValue = false;
    (rows || []).forEach(leg => {
      const legPar = Number(leg && leg.par);
      if (Number.isFinite(legPar)) par += legPar;
      const legMarketValue = editorLegMarketValue(leg);
      if (legMarketValue != null) {
        marketValue += legMarketValue;
        hasMarketValue = true;
      }
    });
    return {
      par,
      marketValue: hasMarketValue ? marketValue : null
    };
  }

  function renderLegSideTable(side, rows, isDraft) {
    const title = side === 'sell' ? 'Funding Source (Sells)' : 'Investments (Buys)';
    const tag = side === 'sell' ? 'sell' : 'buy';
    const totals = editorLegHeaderMetrics(rows);
    const heads = LEG_INPUTS.map(c => `<th${c.secondary ? ' class="swap-leg-secondary"' : ''}>${escapeHtml(c.label)}</th>`).join('');
    const body = rows.length
      ? rows.map(leg => renderLegEditorRow(leg, isDraft)).join('')
      : `<tr><td colspan="${LEG_INPUTS.length + 1}" class="swap-leg-empty">No ${tag} legs yet. ${isDraft ? 'Use the buttons above to add one.' : ''}</td></tr>`;
    const unfilledCount = rows.filter(legIsUnfilled).length;
    const unfilledBadge = unfilledCount > 0
      ? ` <span class="swap-leg-unfilled" title="Rows with no CUSIP or par; will be dropped before send.">${unfilledCount} unfilled</span>`
      : '';
    const addButtons = !isDraft ? '' : (side === 'buy'
      ? `<div class="swap-leg-add-group">
           <button type="button" class="small-btn" data-add-leg="${tag}">Add buy</button>
           <button type="button" class="small-btn" data-add-leg-hypothetical="${tag}" title="Add a CUSIP-less leg priced at par — type a yield and par to test a swap.">Add hypothetical</button>
         </div>`
      : `<button type="button" class="small-btn" data-add-leg="${tag}">Add ${tag}</button>`);
    return `
      <section class="swap-editor-side" data-side="${tag}">
        <header>
          <div class="swap-leg-head-main">
            <strong>${escapeHtml(title)} (${rows.length})${unfilledBadge}</strong>
            <span class="swap-leg-head-metrics">Par ${compactCurrency(totals.par)}${totals.marketValue == null ? '' : ` · Market ${compactCurrency(totals.marketValue)}`}</span>
          </div>
          ${addButtons}
        </header>
        <table class="swap-leg-table">
          <thead><tr>${heads}<th></th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </section>`;
  }

  function renderLegEditorRow(leg, isDraft) {
    const side = leg.side;
    const cells = LEG_INPUTS.map(col => {
      const value = leg[col.key] == null ? '' : leg[col.key];
      const step = col.step ? ` step="${col.step}"` : '';
      const range = `${col.min != null ? ` min="${col.min}"` : ''}${col.max != null ? ` max="${col.max}"` : ''}${col.minExclusive ? ` data-min-exclusive="1"` : ''}`;
      const readonly = isDraft ? '' : 'readonly';
      // Wire the CUSIP column to the appropriate datalist for autocomplete
      // + smart-fill of all sibling fields when the rep picks a known one.
      const listAttr = col.key === 'cusip' && isDraft
        ? ` list="${side === 'sell' ? 'swapHoldingsDatalist' : 'swapInventoryDatalist'}"`
        : '';
      const tdClass = col.secondary ? ' class="swap-leg-secondary"' : '';
      // Flag fields the server derived (e.g. a yield computed from price +
      // coupon + maturity when the workbook shipped it blank) so the rep can
      // tell a computed value from one that came off the source file.
      const isDerived = leg.derived && leg.derived[col.key];
      const inputAttrs = isDerived
        ? ` class="swap-leg-derived" title="Computed from price + coupon + maturity — the source workbook didn't supply this"`
        : '';
      return `<td${tdClass}><input type="${col.type}" data-leg-field="${col.key}"${step}${range}${listAttr}${inputAttrs} value="${escapeHtml(value)}" ${readonly}></td>`;
    }).join('');
    const del = isDraft
      ? `<button type="button" class="swap-leg-del" data-del-leg="${leg.id}" title="Remove leg">&times;</button>`
      : '';
    // Buy legs in a draft get a one-click "size to proceeds" action: solve the
    // par that balances total buy proceeds against sell proceeds (cash-neutral).
    const size = (isDraft && side === 'buy')
      ? `<button type="button" class="swap-leg-size" data-size-leg="${leg.id}" title="Size this buy's par so total buy proceeds match sell proceeds (cash-neutral settle)">Size</button>`
      : '';
    const matchMarketValue = (isDraft && side === 'buy')
      ? `<button type="button" class="swap-leg-size" data-match-mv-leg="${leg.id}" title="Size this buy's par so total buy market value matches sell market value">Match MV</button>`
      : '';
    return `<tr data-leg-id="${leg.id}" data-side="${escapeHtml(side)}">${cells}<td class="swap-leg-actions">${size}${matchMarketValue}${del}</td></tr>`;
  }

  function renderEditorSummary(summary, proposal) {
    if (!summary) {
      return `<aside class="swap-editor-summary swap-editor-summary-empty">Add legs to see the live summary.</aside>`;
    }
    const d = summary.dollars || {};
    const diff = summary.portfolioDiff || {};
    const sellsAgg = summary.sells || {};
    const buysAgg = summary.buys || {};
    // Which metrics legitimately require the OTHER side of the swap. Used to
    // swap "—" for a contextual hint ("Add a buy leg") so the rep knows the
    // empty cell isn't a bug. Decisions:
    //  - Total income, Net interest, Realized G/L: computable from sells
    //    alone (interest given up, loss harvested). Show actual numbers.
    //  - Settle adjust, Breakeven, Δ TE Bk Yld, Δ TE Mkt Yld: need both
    //    sides — replacement proceeds, replacement income, before/after
    //    yields. Show a hint when the missing side is empty.
    const hasSells = summary.sells && summary.sells.par > 0;
    const hasBuys = summary.buys && summary.buys.par > 0;
    const blockedHint = (needsSells, needsBuys) => {
      if (needsBuys && !hasBuys) return 'Add a buy leg';
      if (needsSells && !hasSells) return 'Add a sell leg';
      return null;
    };
    const moneyChip = (label, value, opts = {}) => {
      const hint = blockedHint(opts.needsSells, opts.needsBuys);
      let body;
      if (value != null) {
        body = value < 0 ? `(${Math.abs(value).toLocaleString('en-US')})` : value.toLocaleString('en-US');
      } else if (hint) {
        body = `<span class="swap-summary-hint">${escapeHtml(hint)}</span>`;
      } else {
        body = '—';
      }
      return `<div><dt>${escapeHtml(label)}</dt><dd>${body}</dd></div>`;
    };
    const moneyValue = (value, opts = {}) => {
      const hint = blockedHint(opts.needsSells, opts.needsBuys);
      if (value != null) {
        const formatted = Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 0, minimumFractionDigits: 0 });
        return value < 0 ? `(${formatted})` : formatted;
      }
      return hint ? `<span class="swap-summary-hint">${escapeHtml(hint)}</span>` : '—';
    };
    const pctValue = (value, opts = {}) => {
      const hint = blockedHint(opts.needsSells, opts.needsBuys);
      if (value != null) return value.toFixed(3) + '%';
      return hint ? `<span class="swap-summary-hint">${escapeHtml(hint)}</span>` : '—';
    };
    const numValue = (value, opts = {}) => {
      const hint = blockedHint(opts.needsSells, opts.needsBuys);
      if (value != null) return Number(value).toFixed(2);
      return hint ? `<span class="swap-summary-hint">${escapeHtml(hint)}</span>` : '—';
    };
    const summaryRow = (label, sellValue, buyValue, diffValue, type = 'money') => {
      const fmt = type === 'pct' ? pctValue : (type === 'num' ? numValue : moneyValue);
      const diffNeedsBuys = { needsBuys: true };
      return `<tr>
        <th scope="row">${escapeHtml(label)}</th>
        <td>${fmt(sellValue)}</td>
        <td>${fmt(buyValue, { needsSells: false, needsBuys: false })}</td>
        <td>${fmt(diffValue, diffNeedsBuys)}</td>
      </tr>`;
    };
    const pctChip = (label, value, opts = {}) => {
      const hint = blockedHint(opts.needsSells, opts.needsBuys);
      let body;
      if (value != null) body = value.toFixed(3) + '%';
      else if (hint) body = `<span class="swap-summary-hint">${escapeHtml(hint)}</span>`;
      else body = '—';
      return `<div><dt>${escapeHtml(label)}</dt><dd>${body}</dd></div>`;
    };
    const breakevenBody = summary.breakevenMonths != null
      ? summary.breakevenMonths.toFixed(1) + ' mo'
      : (hasSells && !hasBuys
        ? `<span class="swap-summary-hint">Add a buy leg</span>`
        : '—');
    return `
      <aside class="swap-editor-summary">
        <h4>Live summary</h4>
        <div class="swap-summary-compare" aria-label="Portfolio comparison">
          <table>
            <thead>
              <tr><th>Metric</th><th>Sells</th><th>Buys</th><th>Diff</th></tr>
            </thead>
            <tbody>
              ${summaryRow('Par', sellsAgg.par, buysAgg.par, diff.par)}
              ${summaryRow('Market value', sellsAgg.marketValue, buysAgg.marketValue, diff.marketValue)}
              ${summaryRow('Accrued', sellsAgg.accrued, buysAgg.accrued, (buysAgg.accrued != null && sellsAgg.accrued != null) ? buysAgg.accrued - sellsAgg.accrued : null)}
              ${summaryRow('TE market yield', sellsAgg.teMarketYield, buysAgg.teMarketYield, diff.teMarketYield, 'pct')}
              ${summaryRow('WAL', sellsAgg.averageLife, buysAgg.averageLife, diff.averageLife, 'num')}
            </tbody>
          </table>
        </div>
        <dl class="swap-summary-grid">
          ${moneyChip('Sell par $', sellsAgg.par)}
          ${moneyChip('Buy par $', buysAgg.par, { needsBuys: true })}
          ${moneyChip('Par diff $', diff.par, { needsBuys: true })}
          ${moneyChip('Total income $', d.totalIncome)}
          ${moneyChip('Net interest $', d.netInterest)}
          ${moneyChip('Realized G/L $', d.realizedGainLoss)}
          ${moneyChip('Settle adjust $', summary.settleAdjust, { needsBuys: true })}
          <div><dt>Breakeven</dt><dd>${breakevenBody}</dd></div>
          <div><dt>Horizon</dt><dd>${summary.horizonYears == null ? '—' : summary.horizonYears.toFixed(2) + ' yr'}</dd></div>
          ${pctChip('Δ TE Bk Yld', diff.teBookYield, { needsBuys: true })}
          ${pctChip('Δ TE Mkt Yld', diff.teMarketYield, { needsBuys: true })}
        </dl>
      </aside>`;
  }

  function bindEditorHandlers(record) {
    const body = document.getElementById('swapBuilderBody');
    if (!body) return;
    body.querySelector('[data-editor-back]')?.addEventListener('click', exitEditorToHome);
    body.querySelector('[data-editor-cancel]')?.addEventListener('click', () => cancelProposalFromEditor());
    body.querySelector('[data-editor-send]')?.addEventListener('click', () => sendProposalFromEditor());
    body.querySelector('[data-editor-execute]')?.addEventListener('click', () => executeProposalFromEditor());
    body.querySelector('[data-editor-clone]')?.addEventListener('click', () => cloneProposalToDraft());
    body.querySelectorAll('[data-editor-field]').forEach(input => {
      input.addEventListener('change', () => queueProposalHeaderUpdate(input));
    });
    body.querySelectorAll('[data-add-leg]').forEach(btn => {
      btn.addEventListener('click', () => addEmptyLeg(btn.dataset.addLeg));
    });
    body.querySelectorAll('[data-add-leg-hypothetical]').forEach(btn => {
      btn.addEventListener('click', addHypotheticalBuyLeg);
    });
    body.querySelectorAll('[data-del-leg]').forEach(btn => {
      btn.addEventListener('click', () => deleteLeg(Number(btn.dataset.delLeg)));
    });
    body.querySelectorAll('[data-size-leg]').forEach(btn => {
      btn.addEventListener('click', () => sizeBuyLeg(Number(btn.dataset.sizeLeg)));
    });
    body.querySelectorAll('[data-match-mv-leg]').forEach(btn => {
      btn.addEventListener('click', () => matchBuyLegMarketValue(Number(btn.dataset.matchMvLeg)));
    });
    body.querySelectorAll('tr[data-leg-id]').forEach(tr => {
      tr.querySelectorAll('input[data-leg-field]').forEach(input => {
        input.addEventListener('input', () => {
          if (input.dataset.legField === 'marketYieldYtw') {
            delete input.dataset.autoAtParYield;
          }
          previewHypotheticalAtParYield(Number(tr.dataset.legId), input);
        });
        input.addEventListener('change', () => {
          // CUSIP changes are the "pick" event — if the value matches a known
          // holding (sells) or inventory item (buys), bulk-fill the row from
          // the source. Otherwise just persist what the rep typed.
          if (input.dataset.legField === 'cusip') {
            const picked = lookupSwapPickerSource(tr.dataset.side, input.value);
            if (picked) {
              return autoFillLegFromPick(Number(tr.dataset.legId), picked, tr);
            }
          }
          queueLegUpdate(Number(tr.dataset.legId), input);
        });
      });
    });
  }

  function lookupSwapPickerSource(side, cusipRaw) {
    const cusip = String(cusipRaw || '').toUpperCase().trim();
    if (!cusip) return null;
    if (side === 'sell') return swapBuilderState.holdingsByCusip.get(cusip) || null;
    if (side === 'buy') return swapBuilderState.inventoryByCusip.get(cusip) || null;
    return null;
  }

  async function autoFillLegFromPick(legId, picked, tr) {
    const id = swapBuilderState.proposalId;
    if (!id || !legId) return;
    // Build a patch with every field the source has. Server will recompute
    // accrued on top from settle + 30/360 / Actual/Actual.
    const patch = {
      cusip: picked.cusip || '',
      description: picked.description || '',
      sector: picked.sector || '',
      coupon: picked.coupon ?? null,
      maturity: picked.maturity || '',
      callDate: picked.callDate || '',
      par: picked.par ?? null,
      bookPrice: picked.bookPrice ?? null,
      marketPrice: picked.marketPrice ?? null,
      bookYieldYtm: picked.bookYieldYtm ?? null,
      bookYieldYtw: picked.bookYieldYtw ?? null,
      marketYieldYtm: picked.marketYieldYtm ?? null,
      marketYieldYtw: picked.marketYieldYtw ?? null,
      modifiedDuration: picked.modifiedDuration ?? null,
      averageLife: picked.averageLife ?? null,
      sourceKind: picked.sourceKind || 'manual',
      sourceRef: picked.sourceRef || '',
      sourceDate: picked.sourceDate || picked.reportDate || ''
    };
    try {
      const res = await fetch(`/api/swap-proposals/${encodeURIComponent(id)}/legs/${legId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Auto-fill failed');
      swapBuilderState.record = data;
      // Full re-render so all the new field values appear in inputs.
      renderProposalEditor(data);
      const fromLabel = tr && tr.dataset.side === 'sell' ? 'holdings' : "today's inventory";
      showToast(`Filled leg from ${fromLabel}`);
    } catch (err) {
      showToast('Auto-fill failed: ' + (err.message || err), true);
    }
  }

  // Block only clearly out-of-range numbers before a PATCH, marking the field.
  // Ignores stepMismatch so a value like a 5.1234% yield against step="0.001"
  // isn't false-flagged. The server (validateLegInput) remains the hard gate.
  function inputRangeOk(input) {
    if (!input || input.type !== 'number') return true;
    const v = input.validity;
    const min = input.min === '' ? null : Number(input.min);
    const minExclusive = input.dataset.minExclusive === '1';
    if (minExclusive && Number.isFinite(min) && input.value !== '' && Number(input.value) <= min) {
      input.classList.add('swap-input-invalid');
      showToast(`Value must be greater than ${min}`, true);
      return false;
    }
    if (v.rangeUnderflow || v.rangeOverflow) {
      input.classList.add('swap-input-invalid');
      showToast(input.validationMessage || 'Value is out of range', true);
      return false;
    }
    input.classList.remove('swap-input-invalid');
    return true;
  }

  function queueProposalHeaderUpdate(input) {
    const id = swapBuilderState.proposalId;
    if (!id) return;
    if (!inputRangeOk(input)) return;
    const field = input.dataset.editorField;
    const value = input.type === 'number' ? (input.value === '' ? null : Number(input.value)) : input.value;
    debouncedPatchProposal(id, { [field]: value });
  }

  function previewHypotheticalAtParYield(legId, input, patch = null) {
    const field = input && input.dataset ? input.dataset.legField : '';
    if (field !== 'coupon' && field !== 'marketPrice') return false;
    const tr = input.closest('tr[data-leg-id]');
    const cusipInput = tr && tr.querySelector('input[data-leg-field="cusip"]');
    const couponInput = tr && tr.querySelector('input[data-leg-field="coupon"]');
    const ytwInput = tr && tr.querySelector('input[data-leg-field="marketYieldYtw"]');
    const mktPxInput = tr && tr.querySelector('input[data-leg-field="marketPrice"]');
    const couponRaw = field === 'coupon' ? input.value : (couponInput ? couponInput.value : '');
    const marketPriceRaw = field === 'marketPrice' ? input.value : (mktPxInput ? mktPxInput.value : '');
    const couponValue = couponRaw === '' ? null : Number(couponRaw);
    const marketPriceValue = marketPriceRaw === '' ? null : Number(marketPriceRaw);
    const currentLeg = swapBuilderState.record && Array.isArray(swapBuilderState.record.legs)
      ? swapBuilderState.record.legs.find(leg => Number(leg.id) === Number(legId))
      : null;
    const priorCoupon = currentLeg == null || currentLeg.coupon == null ? null : Number(currentLeg.coupon);
    const priorYtw = currentLeg == null || currentLeg.marketYieldYtw == null ? null : Number(currentLeg.marketYieldYtw);
    const ytwWasAutoSynced = Number.isFinite(priorCoupon) && Number.isFinite(priorYtw)
      && Math.abs(priorCoupon - priorYtw) < 0.0001;
    const ytwWasPreviewSynced = ytwInput && ytwInput.dataset.autoAtParYield === '1';
    const isHypotheticalAtPar = tr && tr.dataset.side === 'buy'
      && cusipInput && !cusipInput.value.trim()
      && Number.isFinite(couponValue)
      && marketPriceValue === 100;
    if (!isHypotheticalAtPar || !ytwInput || (ytwInput.value !== '' && !ytwWasAutoSynced && !ytwWasPreviewSynced)) {
      return false;
    }
    ytwInput.value = couponValue;
    ytwInput.dataset.autoAtParYield = '1';
    if (patch) patch.marketYieldYtw = couponValue;
    return true;
  }

  function queueLegUpdate(legId, input) {
    const id = swapBuilderState.proposalId;
    if (!id || !legId) return;
    if (!inputRangeOk(input)) return;
    const field = input.dataset.legField;
    const value = input.type === 'number' ? (input.value === '' ? null : Number(input.value)) : input.value;
    const patch = { [field]: value };
    // Hypothetical-buy convenience: an at-par bond has coupon == yield. When
    // the rep types a yield into a CUSIP-less, par-priced row and hasn't
    // entered a coupon yet, mirror it so duration and accrued can compute.
    if (field === 'marketYieldYtw' && value != null) {
      const tr = input.closest('tr[data-leg-id]');
      const cusipInput = tr && tr.querySelector('input[data-leg-field="cusip"]');
      const couponInput = tr && tr.querySelector('input[data-leg-field="coupon"]');
      const mktPxInput = tr && tr.querySelector('input[data-leg-field="marketPrice"]');
      const isHypothetical = cusipInput && !cusipInput.value.trim()
        && mktPxInput && Number(mktPxInput.value) === 100;
      if (isHypothetical && couponInput && couponInput.value === '') {
        patch.coupon = value;
        couponInput.value = value;
      }
    }
    if ((field === 'coupon' || field === 'marketPrice') && value != null) previewHypotheticalAtParYield(legId, input, patch);
    patchLeg(id, legId, patch);
  }

  let proposalPatchTimer = null;
  let pendingHeaderPatch = {};
  function debouncedPatchProposal(id, patch) {
    Object.assign(pendingHeaderPatch, patch);
    clearTimeout(proposalPatchTimer);
    proposalPatchTimer = setTimeout(async () => {
      const body = { ...pendingHeaderPatch };
      pendingHeaderPatch = {};
      try {
        const res = await fetch('/api/swap-proposals/' + encodeURIComponent(id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Update failed');
        swapBuilderState.record = data;
        updateLiveSummary(data);
      } catch (err) {
        showToast('Save failed: ' + (err.message || err), true);
      }
    }, 350);
  }

  async function patchLeg(id, legId, patch) {
    try {
      const res = await fetch(`/api/swap-proposals/${encodeURIComponent(id)}/legs/${legId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Leg update failed');
      swapBuilderState.record = data;
      updateLiveSummary(data);
    } catch (err) {
      showToast('Leg save failed: ' + (err.message || err), true);
    }
  }

  // Ask the server for the par that balances this buy leg's proceeds against
  // total sell proceeds (cash-neutral), show the rep the numbers, and on
  // confirm apply it through the normal leg PATCH so the swap rules and
  // accrued recompute. The route is read-only — nothing changes until the
  // PATCH below.
  async function sizeBuyLeg(legId) {
    const id = swapBuilderState.proposalId;
    if (!id || !legId) return;
    const fmt = n => (n == null ? '—' : Number(n).toLocaleString('en-US'));
    try {
      const res = await fetch(`/api/swap-proposals/${encodeURIComponent(id)}/size-buy?flexLegId=${encodeURIComponent(legId)}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not size this buy leg');
      const p = data.proceeds || {};
      const lines = [
        `Size this buy leg to ${fmt(data.suggestedPar)} par?`,
        '',
        `Sell proceeds:            ${fmt(p.sell)}`,
        p.lockedBuy ? `Other buys (locked):      ${fmt(p.lockedBuy)}` : null,
        `Buy proceeds at this par: ${fmt(p.flexAtSuggested)}`,
        `Net cash to settle:       ${fmt(p.netCash)}`,
        '',
        `(currently ${data.currentPar == null ? 'unset' : fmt(data.currentPar)} par)`
      ].filter(l => l !== null);
      if (!confirm(lines.join('\n'))) return;
      const patchRes = await fetch(`/api/swap-proposals/${encodeURIComponent(id)}/legs/${legId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ par: data.suggestedPar })
      });
      const patched = await patchRes.json();
      if (!patchRes.ok) throw new Error(patched.error || 'Could not apply the sized par');
      swapBuilderState.record = patched;
      renderProposalEditor(patched);
      showToast(`Sized buy leg to ${fmt(data.suggestedPar)} par`);
    } catch (err) {
      showToast('Size to proceeds failed: ' + (err.message || err), true);
    }
  }

  async function matchBuyLegMarketValue(legId) {
    const id = swapBuilderState.proposalId;
    const record = swapBuilderState.record;
    if (!id || !legId || !record) return;
    const fmt = n => (n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }));
    try {
      const legs = Array.isArray(record.legs) ? record.legs : [];
      const buys = legs.filter(l => l.side === 'buy');
      const flex = buys.find(l => Number(l.id) === Number(legId));
      if (!flex) throw new Error('That row is not a buy leg.');
      const sellMarketValue = record.computedSummary && record.computedSummary.sells
        ? Number(record.computedSummary.sells.marketValue)
        : null;
      if (!Number.isFinite(sellMarketValue) || sellMarketValue <= 0) {
        throw new Error('Add sell legs with par and market price before matching market value.');
      }
      const lockedBuyMarketValue = buys
        .filter(l => Number(l.id) !== Number(legId))
        .reduce((sum, leg) => sum + (editorLegMarketValue(leg) || 0), 0);
      const targetMarketValue = sellMarketValue - lockedBuyMarketValue;
      if (!(targetMarketValue > 0)) {
        throw new Error('Other buy legs already meet or exceed the sell market value.');
      }
      const marketPrice = Number(flex.marketPrice);
      if (!Number.isFinite(marketPrice) || marketPrice <= 0) {
        throw new Error('Enter a market price on this buy leg before matching market value.');
      }
      const suggestedPar = Math.round(targetMarketValue * 100 / marketPrice);
      const resultingMarketValue = suggestedPar * marketPrice / 100;
      const lines = [
        `Size this buy leg to ${fmt(suggestedPar)} par?`,
        '',
        `Sell market value:        ${fmt(sellMarketValue)}`,
        lockedBuyMarketValue ? `Other buy market value:   ${fmt(lockedBuyMarketValue)}` : null,
        `Target for this buy:      ${fmt(targetMarketValue)}`,
        `Market value at this par: ${fmt(resultingMarketValue)}`
      ].filter(l => l !== null);
      if (!confirm(lines.join('\n'))) return;
      const patchRes = await fetch(`/api/swap-proposals/${encodeURIComponent(id)}/legs/${legId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ par: suggestedPar })
      });
      const patched = await patchRes.json();
      if (!patchRes.ok) throw new Error(patched.error || 'Could not apply the matched par');
      swapBuilderState.record = patched;
      renderProposalEditor(patched);
      showToast(`Matched buy market value with ${fmt(suggestedPar)} par`);
    } catch (err) {
      showToast('Match market value failed: ' + (err.message || err), true);
    }
  }

  function updateLiveSummary(record) {
    // Any edit invalidates a previous blocked-send list — clear it so the rep
    // isn't staring at stale gaps after fixing them.
    clearSendIssues();
    const body = document.getElementById('swapBuilderBody');
    if (!body) return;
    const summaryNode = body.querySelector('.swap-editor-summary');
    if (!summaryNode) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = renderEditorSummary(record.computedSummary, record.proposal);
    const fresh = wrap.firstElementChild;
    if (fresh) summaryNode.replaceWith(fresh);
    updateEditorLegHeaderMetrics(record);
  }

  function updateEditorLegHeaderMetrics(record) {
    const body = document.getElementById('swapBuilderBody');
    if (!body || !record || !Array.isArray(record.legs)) return;
    ['sell', 'buy'].forEach(side => {
      const section = body.querySelector(`.swap-editor-side[data-side="${side}"]`);
      const metricEl = section && section.querySelector('.swap-leg-head-metrics');
      if (!metricEl) return;
      const totals = editorLegHeaderMetrics(record.legs.filter(leg => leg.side === side));
      metricEl.textContent = `Par ${compactCurrency(totals.par)}${totals.marketValue == null ? '' : ` · Market ${compactCurrency(totals.marketValue)}`}`;
    });
  }

  async function addEmptyLeg(side, presets = null) {
    const id = swapBuilderState.proposalId;
    if (!id) return;
    try {
      const body = { side, sourceKind: 'manual', ...(presets || {}) };
      const res = await fetch(`/api/swap-proposals/${encodeURIComponent(id)}/legs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Add leg failed');
      swapBuilderState.record = data;
      renderProposalEditor(data);
    } catch (err) {
      showToast('Could not add leg: ' + (err.message || err), true);
    }
  }

  async function addHypotheticalBuyLeg() {
    return addEmptyLeg('buy', {
      description: 'Hypothetical buy',
      marketPrice: 100,
      sourceKind: 'manual'
    });
  }

  async function deleteLeg(legId) {
    const id = swapBuilderState.proposalId;
    if (!id || !legId) return;
    if (!confirm('Remove this leg?')) return;
    try {
      const res = await fetch(`/api/swap-proposals/${encodeURIComponent(id)}/legs/${legId}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      swapBuilderState.record = data;
      renderProposalEditor(data);
    } catch (err) {
      showToast('Could not remove leg: ' + (err.message || err), true);
    }
  }

  async function sendProposalFromEditor() {
    const id = swapBuilderState.proposalId;
    if (!id) return;
    if (!confirm('Send this proposal? Once sent, legs are frozen and a Bond Swap entry will be added to the Strategies queue.')) return;
    clearSendIssues();
    try {
      const res = await fetch(`/api/swap-proposals/${encodeURIComponent(id)}/send`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        // The completeness gate returns a per-leg list of what's missing —
        // surface it inline next to the editor instead of burying it in a toast.
        if (Array.isArray(data.issues) && data.issues.length) {
          showSendIssues(data.issues);
          showToast(data.error || 'This proposal is missing required data', true);
          return;
        }
        throw new Error(data.error || 'Send failed');
      }
      swapBuilderState.record = data;
      renderProposalEditor(data);
      showToast(`Proposal ${id} sent — added to Strategies queue`);
    } catch (err) {
      showToast('Send failed: ' + (err.message || err), true);
    }
  }

  // The pre-send completeness gate (server) can block a send with a list of
  // per-leg gaps. Render them in the editor's alert banner and scroll it into
  // view; clearSendIssues() hides it once the rep edits anything or re-sends.
  function showSendIssues(issues) {
    const box = document.getElementById('swapSendIssues');
    if (!box) return;
    box.innerHTML = `<strong>Can't send yet — complete these legs first:</strong>` +
      `<ul>${issues.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function clearSendIssues() {
    const box = document.getElementById('swapSendIssues');
    if (!box) return;
    box.hidden = true;
    box.innerHTML = '';
  }

  async function cloneProposalToDraft() {
    const id = swapBuilderState.proposalId;
    if (!id) return;
    try {
      const res = await fetch(`/api/swap-proposals/${encodeURIComponent(id)}/clone`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Clone failed');
      showToast(`Created new draft ${data.proposal.id} from ${id}`);
      await openProposalInEditor(data.proposal.id);
      loadRecentSwapProposals(swapBuilderState.bankId);
    } catch (err) {
      showToast('Clone failed: ' + (err.message || err), true);
    }
  }

  async function executeProposalFromEditor() {
    const id = swapBuilderState.proposalId;
    if (!id) return;
    if (!confirm('Mark this proposal executed? The linked Strategies queue entry will transition to Completed.')) return;
    try {
      const res = await fetch(`/api/swap-proposals/${encodeURIComponent(id)}/execute`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Execute failed');
      swapBuilderState.record = data;
      renderProposalEditor(data);
      showToast(`Proposal ${id} executed — Strategies entry moved to Completed`);
    } catch (err) {
      showToast('Execute failed: ' + (err.message || err), true);
    }
  }

  async function cancelProposalFromEditor() {
    const id = swapBuilderState.proposalId;
    if (!id) return;
    if (!confirm('Cancel this proposal? It will be archived from the Strategies queue if linked.')) return;
    try {
      const res = await fetch(`/api/swap-proposals/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Cancel failed');
      swapBuilderState.record = data;
      renderProposalEditor(data);
      showToast(`Proposal ${id} cancelled`);
    } catch (err) {
      showToast('Cancel failed: ' + (err.message || err), true);
    }
  }

  async function loadRecentSwapProposals(bankId) {
    const wrap = document.getElementById('swapRecentProposals');
    const list = document.getElementById('swapRecentList');
    if (!wrap || !list) return;
    try {
      const qs = bankId ? '?bankId=' + encodeURIComponent(bankId) + '&limit=8' : '?limit=8';
      const res = await fetch('/api/swap-proposals' + qs, { cache: 'no-store' });
      const data = await res.json();
      const items = Array.isArray(data.proposals) ? data.proposals : [];
      if (!items.length) { wrap.hidden = true; return; }
      wrap.hidden = false;
      list.innerHTML = items.map(p => `
        <li>
          <a href="#bond-swap?bank=${encodeURIComponent(p.bankId || '')}&proposal=${encodeURIComponent(p.id)}" data-open-proposal="${escapeHtml(p.id)}">
            <strong>${escapeHtml(p.id)}</strong>
            <span>${escapeHtml(p.title || 'Bond Swap')}</span>
            <em>
              <span class="swap-status-pill ${escapeHtml(p.status || 'draft')}">${escapeHtml(p.status || 'draft')}</span>
              ${escapeHtml(p.updatedAt ? p.updatedAt.slice(0, 10) : '')}
            </em>
          </a>
        </li>`).join('');
      list.querySelectorAll('[data-open-proposal]').forEach(a => {
        a.addEventListener('click', e => {
          e.preventDefault();
          openProposalInEditor(a.dataset.openProposal);
        });
      });
    } catch (_) {
      wrap.hidden = true;
    }
  }

  // ===========================================================================
  // Peer Groups page
  //
  // User-curated cohorts for tear-sheet peer comparison. Server stores cohort
  // *definitions* in peer-groups.sqlite; averages are computed live from
  // bank-data.sqlite per peer-averages.js. This UI is just CRUD + a live
  // population preview as the rep types filters.
  // ===========================================================================

  const peerGroupsState = {
    cohorts: [],
    selectedId: null,
    isCreating: false,
    archiveFilter: '',
    previewDebounce: null
  };

  const LOAN_MIX_FIELDS = [
    { key: 'agSum', label: 'Ag exposure (farmland + ag production)' },
    { key: 'farmLoansToLoans', label: 'Farmland / Loans' },
    { key: 'agProdLoansToLoans', label: 'Agricultural Production / Loans' },
    { key: 'realEstateLoansToLoans', label: 'Real Estate / Loans' },
    { key: 'ciLoansToLoans', label: 'C&I Loans / Loans' }
  ];

  const US_STATES = [
    'AK','AL','AR','AZ','CA','CO','CT','DC','DE','FL','GA','HI','IA','ID','IL',
    'IN','KS','KY','LA','MA','MD','ME','MI','MN','MO','MS','MT','NC','ND','NE',
    'NH','NJ','NM','NV','NY','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
    'VA','VT','WA','WI','WV','WY'
  ];

  function setupPeerGroups() {
    const newBtn = document.getElementById('peerGroupNewBtn');
    if (newBtn) newBtn.addEventListener('click', () => startCreatePeerGroup());
    const archive = document.getElementById('peerGroupsArchiveFilter');
    if (archive) archive.addEventListener('change', () => {
      peerGroupsState.archiveFilter = archive.value;
      loadPeerGroups();
    });
    const detail = document.getElementById('peerGroupsDetail');
    if (detail) detail.addEventListener('click', (e) => {
      if (e.target.closest('[data-pg-start-create]')) startCreatePeerGroup();
    });
  }

  async function loadPeerGroups() {
    const list = document.getElementById('peerGroupsList');
    if (!list) return;
    const filter = peerGroupsState.archiveFilter;
    const qs = filter === 'all' || filter === 'only' ? '?includeArchived=1' : '';
    try {
      const res = await fetch('/api/peer-groups' + qs, { cache: 'no-store' });
      const data = await res.json();
      const all = Array.isArray(data.peerGroups) ? data.peerGroups : [];
      peerGroupsState.cohorts = filter === 'only'
        ? all.filter(c => c.archivedAt)
        : (filter === 'all' ? all : all.filter(c => !c.archivedAt));
      renderPeerGroupsList();
      if (peerGroupsState.isCreating) {
        renderPeerGroupBuilder(null);
      } else if (peerGroupsState.selectedId) {
        const found = peerGroupsState.cohorts.find(c => c.id === peerGroupsState.selectedId);
        if (found) renderPeerGroupBuilder(found);
        else clearPeerGroupDetail();
      } else {
        clearPeerGroupDetail();
      }
    } catch (err) {
      list.innerHTML = `<li class="peer-groups-empty">Could not load peer groups: ${escapeHtml(err.message || err)}</li>`;
    }
  }

  function renderPeerGroupsList() {
    const list = document.getElementById('peerGroupsList');
    if (!list) return;
    if (!peerGroupsState.cohorts.length) {
      list.innerHTML = '<li class="peer-groups-empty">No cohorts yet. Click "+ New peer group" to create one.</li>';
      return;
    }
    list.innerHTML = peerGroupsState.cohorts.map(c => {
      const active = c.id === peerGroupsState.selectedId && !peerGroupsState.isCreating ? ' active' : '';
      const archivedBadge = c.archivedAt ? ' <span class="peer-groups-archived-pill">Archived</span>' : '';
      const summary = peerGroupCriteriaSummary(c.criteria || {});
      return `
        <li>
          <button type="button" class="peer-groups-list-item${active}" data-peer-group-id="${escapeHtml(c.id)}">
            <strong>${escapeHtml(c.name)}${archivedBadge}</strong>
            <em>${escapeHtml(c.id)}</em>
            <span>${escapeHtml(summary || 'No filters — every bank')}</span>
          </button>
        </li>`;
    }).join('');
    list.querySelectorAll('[data-peer-group-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        peerGroupsState.isCreating = false;
        peerGroupsState.selectedId = btn.dataset.peerGroupId;
        renderPeerGroupsList();
        const found = peerGroupsState.cohorts.find(c => c.id === peerGroupsState.selectedId);
        if (found) renderPeerGroupBuilder(found);
      });
    });
  }

  function peerGroupCriteriaSummary(criteria) {
    if (!criteria) return '';
    const parts = [];
    if (criteria.assetMin || criteria.assetMax) {
      const fmt = (n) => {
        if (!Number.isFinite(Number(n))) return '';
        const v = Number(n);
        if (v >= 1000000) return '$' + (v / 1000000).toFixed(v % 1000000 === 0 ? 0 : 1) + 'B';
        if (v >= 1000) return '$' + (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + 'M';
        return '$' + v + 'K';
      };
      const lo = criteria.assetMin ? fmt(criteria.assetMin) : '';
      const hi = criteria.assetMax ? fmt(criteria.assetMax) : '';
      if (lo && hi) parts.push(`${lo}–${hi}`);
      else if (lo) parts.push('≥ ' + lo);
      else if (hi) parts.push('≤ ' + hi);
    }
    if (criteria.states && criteria.states.length) {
      parts.push(criteria.states.length > 4 ? `${criteria.states.length} states` : criteria.states.join(', '));
    }
    if (criteria.subchapterS) parts.push(criteria.subchapterS === 'Yes' ? 'Sub-S' : 'C-corp');
    if (criteria.loanMix && criteria.loanMix.length) {
      parts.push(criteria.loanMix.map(r => `${shortLoanMixLabel(r.key)} ${r.op} ${r.value}%`).join(' · '));
    }
    return parts.join(' · ');
  }

  function shortLoanMixLabel(key) {
    const map = {
      agSum: 'Ag',
      farmLoansToLoans: 'Farm',
      agProdLoansToLoans: 'Ag Prod',
      realEstateLoansToLoans: 'RE',
      ciLoansToLoans: 'C&I'
    };
    return map[key] || key;
  }

  function clearPeerGroupDetail() {
    const detail = document.getElementById('peerGroupsDetail');
    if (!detail) return;
    detail.innerHTML = `
      <div class="peer-groups-empty-state">
        <h3>Select a cohort or create a new one</h3>
        <p>Cohorts let you compare a bank against the peer set that actually matches it — size bracket, region, Sub-S vs C-corp, and loan mix. The smallest matching cohort wins on every tear sheet by default; reps can switch on the fly.</p>
        <div class="empty-state-action">
          <button type="button" class="small-btn" data-pg-start-create>Create a cohort</button>
        </div>
      </div>`;
  }

  function startCreatePeerGroup() {
    peerGroupsState.isCreating = true;
    peerGroupsState.selectedId = null;
    renderPeerGroupsList();
    renderPeerGroupBuilder(null);
  }

  function renderPeerGroupBuilder(cohort) {
    const detail = document.getElementById('peerGroupsDetail');
    if (!detail) return;
    const isCreate = !cohort;
    const c = cohort || { name: '', description: '', criteria: {}, archivedAt: null, id: '(new)' };
    const cr = c.criteria || {};
    const archived = !!c.archivedAt;
    detail.innerHTML = `
      <div class="peer-groups-builder">
        <header>
          <div>
            <span class="tool-eyebrow">Peer cohort</span>
            <h3>${escapeHtml(isCreate ? 'New peer group' : c.name)}</h3>
            <small>${escapeHtml(c.id || '')}${archived ? ' · Archived' : ''}</small>
          </div>
          <div class="peer-groups-builder-actions">
            ${isCreate || archived ? '' : `<button type="button" class="small-btn" data-pg-archive>Archive</button>`}
          </div>
        </header>
        <div class="peer-groups-form">
          <label class="peer-groups-row-2"><span>Name</span>
            <input type="text" id="pgName" value="${escapeHtml(c.name)}" placeholder="e.g. Sub-S ag banks under $500M"></label>
          <label class="peer-groups-row-2"><span>Description</span>
            <input type="text" id="pgDescription" value="${escapeHtml(c.description || '')}" placeholder="What this cohort is for"></label>

          <fieldset class="peer-groups-fieldset">
            <legend>Asset size ($000)</legend>
            <label><span>Minimum</span>
              <input type="number" id="pgAssetMin" value="${cr.assetMin == null ? '' : cr.assetMin}" placeholder="e.g. 100000" step="1000"></label>
            <label><span>Maximum</span>
              <input type="number" id="pgAssetMax" value="${cr.assetMax == null ? '' : cr.assetMax}" placeholder="e.g. 500000" step="1000"></label>
            <small>Workbook stores totals in $000 (so $500M = 500000).</small>
          </fieldset>

          <fieldset class="peer-groups-fieldset">
            <legend>Geography</legend>
            <label class="peer-groups-states">
              <span>States (Cmd/Ctrl-click for multiple; empty = any state)</span>
              <select id="pgStates" multiple size="8">
                ${US_STATES.map(s => {
                  const sel = (cr.states || []).includes(s) ? ' selected' : '';
                  return `<option value="${s}"${sel}>${s}</option>`;
                }).join('')}
              </select>
            </label>
          </fieldset>

          <fieldset class="peer-groups-fieldset">
            <legend>Corporate structure</legend>
            <div class="peer-groups-radios">
              <label><input type="radio" name="pgSubS" value="" ${!cr.subchapterS ? 'checked' : ''}> Any</label>
              <label><input type="radio" name="pgSubS" value="Yes" ${cr.subchapterS === 'Yes' ? 'checked' : ''}> Sub-S</label>
              <label><input type="radio" name="pgSubS" value="No" ${cr.subchapterS === 'No' ? 'checked' : ''}> C-corp</label>
            </div>
          </fieldset>

          <fieldset class="peer-groups-fieldset">
            <legend>Loan mix filters</legend>
            <div id="pgLoanMixRows">
              ${(cr.loanMix || []).map((r, idx) => renderLoanMixRow(r, idx)).join('') || '<div class="peer-groups-loan-empty">No loan-mix filters yet.</div>'}
            </div>
            <button type="button" class="small-btn" id="pgAddLoanMix">+ Add filter</button>
          </fieldset>

          <div class="peer-groups-preview" id="pgPreview">
            <strong>Population</strong>
            <span id="pgPreviewCount">—</span>
            <small id="pgPreviewPeriod"></small>
          </div>

          <div class="peer-groups-form-actions">
            ${archived ? '' : `<button type="button" class="publish-btn" id="pgSaveBtn">${isCreate ? 'Create cohort' : 'Save changes'}</button>`}
            <button type="button" class="small-btn" id="pgCancelBtn">${isCreate ? 'Cancel' : 'Close'}</button>
          </div>
        </div>
      </div>
    `;
    bindPeerGroupBuilder(c, isCreate);
    schedulePeerGroupPreview();
  }

  function renderLoanMixRow(r, idx) {
    return `
      <div class="peer-groups-loan-row" data-loan-idx="${idx}">
        <select data-pg-loan-key>
          ${LOAN_MIX_FIELDS.map(f => `<option value="${f.key}" ${f.key === r.key ? 'selected' : ''}>${escapeHtml(f.label)}</option>`).join('')}
        </select>
        <select data-pg-loan-op>
          ${['>=','<=','>','<','='].map(op => `<option value="${op}" ${op === r.op ? 'selected' : ''}>${op}</option>`).join('')}
        </select>
        <input type="number" data-pg-loan-value value="${r.value == null ? '' : r.value}" step="0.1" placeholder="%">
        <button type="button" class="peer-groups-loan-del" data-pg-loan-del="${idx}" title="Remove">&times;</button>
      </div>`;
  }

  function bindPeerGroupBuilder(cohort, isCreate) {
    const detail = document.getElementById('peerGroupsDetail');
    if (!detail) return;
    detail.querySelectorAll('input, select').forEach(el => {
      el.addEventListener('input', schedulePeerGroupPreview);
      el.addEventListener('change', schedulePeerGroupPreview);
    });
    detail.querySelector('#pgAddLoanMix')?.addEventListener('click', () => {
      const rows = detail.querySelector('#pgLoanMixRows');
      const empty = rows?.querySelector('.peer-groups-loan-empty');
      if (empty) empty.remove();
      const idx = rows ? rows.querySelectorAll('.peer-groups-loan-row').length : 0;
      const wrap = document.createElement('div');
      wrap.innerHTML = renderLoanMixRow({ key: 'agSum', op: '>=', value: '' }, idx);
      const row = wrap.firstElementChild;
      rows.appendChild(row);
      row.querySelectorAll('input, select').forEach(el => {
        el.addEventListener('input', schedulePeerGroupPreview);
        el.addEventListener('change', schedulePeerGroupPreview);
      });
      row.querySelector('[data-pg-loan-del]').addEventListener('click', () => { row.remove(); schedulePeerGroupPreview(); });
    });
    detail.querySelectorAll('[data-pg-loan-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.closest('.peer-groups-loan-row')?.remove();
        schedulePeerGroupPreview();
      });
    });
    detail.querySelector('#pgSaveBtn')?.addEventListener('click', () => savePeerGroupForm(cohort, isCreate));
    detail.querySelector('#pgCancelBtn')?.addEventListener('click', () => {
      peerGroupsState.isCreating = false;
      peerGroupsState.selectedId = isCreate ? null : cohort.id;
      if (isCreate) { clearPeerGroupDetail(); renderPeerGroupsList(); }
      else loadPeerGroups();
    });
    detail.querySelector('[data-pg-archive]')?.addEventListener('click', () => archivePeerGroupAction(cohort.id));
  }

  function readPeerGroupBuilderForm() {
    const get = (id) => document.getElementById(id);
    const numOrUndef = (el) => (el && el.value !== '' && Number.isFinite(Number(el.value))) ? Number(el.value) : undefined;
    const states = Array.from(get('pgStates')?.selectedOptions || []).map(o => o.value);
    const subS = (Array.from(document.querySelectorAll('input[name="pgSubS"]')).find(r => r.checked) || {}).value || '';
    const loanMix = Array.from(document.querySelectorAll('.peer-groups-loan-row')).map(row => ({
      key: row.querySelector('[data-pg-loan-key]')?.value,
      op: row.querySelector('[data-pg-loan-op]')?.value,
      value: Number(row.querySelector('[data-pg-loan-value]')?.value)
    })).filter(r => r.key && r.op && Number.isFinite(r.value));
    return {
      name: get('pgName')?.value.trim() || '',
      description: get('pgDescription')?.value.trim() || '',
      criteria: {
        assetMin: numOrUndef(get('pgAssetMin')),
        assetMax: numOrUndef(get('pgAssetMax')),
        states,
        subchapterS: subS || undefined,
        loanMix
      }
    };
  }

  function schedulePeerGroupPreview() {
    if (peerGroupsState.previewDebounce) clearTimeout(peerGroupsState.previewDebounce);
    peerGroupsState.previewDebounce = setTimeout(runPeerGroupPreview, 300);
  }

  async function runPeerGroupPreview() {
    const countEl = document.getElementById('pgPreviewCount');
    const periodEl = document.getElementById('pgPreviewPeriod');
    if (!countEl) return;
    countEl.textContent = '…';
    if (periodEl) periodEl.textContent = '';
    try {
      const form = readPeerGroupBuilderForm();
      const res = await fetch('/api/peer-groups/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ criteria: form.criteria })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Preview failed');
      countEl.textContent = formatNumber(data.populationCount || 0) + ' banks';
      if (periodEl) periodEl.textContent = data.period ? `at ${data.period}` : '';
    } catch (err) {
      countEl.textContent = '—';
      if (periodEl) periodEl.textContent = err.message || '';
    }
  }

  async function savePeerGroupForm(cohort, isCreate) {
    const form = readPeerGroupBuilderForm();
    if (!form.name) { showToast('Name is required', true); return; }
    try {
      const url = isCreate ? '/api/peer-groups' : `/api/peer-groups/${encodeURIComponent(cohort.id)}`;
      const method = isCreate ? 'POST' : 'PATCH';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      showToast(isCreate ? `Created ${data.peerGroup.id}` : 'Saved');
      peerGroupsState.isCreating = false;
      peerGroupsState.selectedId = data.peerGroup.id;
      await loadPeerGroups();
    } catch (err) {
      showToast('Save failed: ' + (err.message || err), true);
    }
  }

  async function archivePeerGroupAction(id) {
    if (!confirm('Archive this peer group? Tear sheets will stop picking it as a best fit.')) return;
    try {
      const res = await fetch('/api/peer-groups/' + encodeURIComponent(id), { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Archive failed');
      showToast('Archived');
      await loadPeerGroups();
    } catch (err) {
      showToast('Archive failed: ' + (err.message || err), true);
    }
  }

  function setupReports() {
    loadReportsSessionReports();
    // Saved definitions + hidden ids now live server-side; hydrate them in the
    // background (and run the one-time localStorage migration), then repaint.
    ensureReportsLoaded().then(() => renderReportsWorkspace());
    setupReportsAppEvents();
    const averagedInput = document.getElementById('reportsAveragedSeriesWorkbookInput');
    const averagedImportBtn = document.getElementById('reportsAveragedSeriesImportBtn');
    const bankListInput = document.getElementById('bondAccountingBankListInput');
    const portfolioInput = document.getElementById('bondAccountingPortfolioInput');
    const bondSearch = document.getElementById('bondAccountingSearchInput');
    const bondStatus = document.getElementById('bondAccountingStatusFilter');
    const bondExport = document.getElementById('bondAccountingExportBtn');
    const peerSearch = document.getElementById('peerAnalysisBankSearchInput');
    const peerSearchBtn = document.getElementById('peerAnalysisBankSearchBtn');
    const peerExport = document.getElementById('peerAnalysisExportBtn');
    const importBtn = document.getElementById('bondAccountingImportBtn');
    if (averagedInput) {
      averagedInput.addEventListener('change', () => {
        const file = averagedInput.files && averagedInput.files[0];
        setText('reportsAveragedSeriesWorkbookName', file ? file.name : 'No workbook selected');
      });
    }
    if (bankListInput) {
      bankListInput.addEventListener('change', () => {
        const file = bankListInput.files && bankListInput.files[0];
        setText('bondAccountingBankListName', file ? file.name : 'No workbook selected');
      });
    }
    if (portfolioInput) {
      portfolioInput.addEventListener('change', () => updateBondAccountingPortfolioPicker());
    }
    if (bondSearch) {
      bondSearch.addEventListener('input', () => {
        bondAccountingFilters.search = bondSearch.value || '';
        renderBondAccountingMatches();
      });
    }
    if (bondStatus) {
      bondStatus.addEventListener('change', () => {
        bondAccountingFilters.status = bondStatus.value || '';
        renderBondAccountingMatches();
      });
    }
    if (peerSearch) {
      let t = null;
      peerSearch.addEventListener('input', () => {
        setPeerAnalysisValidation('');
        clearTimeout(t);
        t = setTimeout(() => searchPeerAnalysisBanks(peerSearch.value), 180);
      });
      peerSearch.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          searchPeerAnalysisBanks(peerSearch.value, { openFirst: true });
        }
      });
    }
    document.querySelectorAll('.reports-picker').forEach(picker => {
      ['dragenter', 'dragover'].forEach(type => picker.addEventListener(type, event => {
        event.preventDefault();
        picker.classList.add('dragging');
      }));
      ['dragleave', 'drop'].forEach(type => picker.addEventListener(type, event => {
        event.preventDefault();
        picker.classList.remove('dragging');
      }));
    });
    const bankPicker = document.getElementById('bondAccountingBankListPicker');
    const averagedPicker = document.getElementById('reportsAveragedSeriesPicker');
    if (averagedPicker && averagedInput) {
      averagedPicker.addEventListener('drop', event => {
        const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
        if (!file) return;
        const transfer = new DataTransfer();
        transfer.items.add(file);
        averagedInput.files = transfer.files;
        setText('reportsAveragedSeriesWorkbookName', file.name);
      });
    }
    if (bankPicker && bankListInput) {
      bankPicker.addEventListener('drop', event => {
        const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
        if (!file) return;
        const transfer = new DataTransfer();
        transfer.items.add(file);
        bankListInput.files = transfer.files;
        setText('bondAccountingBankListName', file.name);
      });
    }
    const portfolioPicker = document.getElementById('bondAccountingPortfolioPicker');
    if (portfolioPicker && portfolioInput) {
      portfolioPicker.addEventListener('drop', event => {
        const files = event.dataTransfer && event.dataTransfer.files ? [...event.dataTransfer.files] : [];
        if (!files.length) return;
        const transfer = new DataTransfer();
        files.filter(file => /\.(xlsm|xlsx|xls)$/i.test(file.name)).forEach(file => transfer.items.add(file));
        portfolioInput.files = transfer.files;
        updateBondAccountingPortfolioPicker();
      });
    }
    if (averagedImportBtn) averagedImportBtn.addEventListener('click', uploadReportsAveragedSeriesImport);
    if (importBtn) importBtn.addEventListener('click', uploadBondAccountingImport);
    if (bondExport) bondExport.addEventListener('click', exportBondAccountingCsv);
    if (peerSearchBtn) peerSearchBtn.addEventListener('click', () => {
      if (peerSearch) peerSearch.focus();
      searchPeerAnalysisBanks(peerSearch ? peerSearch.value : '', { openFirst: true });
    });
    if (peerExport) peerExport.addEventListener('click', exportPeerAnalysisCsv);
    const peerPrint = document.getElementById('peerAnalysisPrintBtn');
    if (peerPrint) peerPrint.addEventListener('click', () => printReportPanel('#peerAnalysisOutput', 'Bank Peer Analysis'));

    const oppoRunBtn = document.getElementById('opportunityRunBtn');
    const oppoExportBtn = document.getElementById('opportunityExportBtn');
    const oppoMinFlags = document.getElementById('opportunityMinFlags');
    const oppoStateFilter = document.getElementById('opportunityStateFilter');
    const oppoSavedOnly = document.getElementById('opportunitySavedOnly');
    if (oppoRunBtn) oppoRunBtn.addEventListener('click', runOpportunityScan);
    if (oppoExportBtn) oppoExportBtn.addEventListener('click', exportOpportunityReportCsv);
    const oppoPrint = document.getElementById('opportunityPrintBtn');
    if (oppoPrint) oppoPrint.addEventListener('click', () => printReportPanel('#opportunityResults', 'Opportunity Scan'));
    if (oppoMinFlags) oppoMinFlags.addEventListener('change', renderOpportunityResults);
    if (oppoStateFilter) oppoStateFilter.addEventListener('input', renderOpportunityResults);
    if (oppoSavedOnly) oppoSavedOnly.addEventListener('change', renderOpportunityResults);
  }

  function uploadReportsAveragedSeriesImport() {
    const input = document.getElementById('reportsAveragedSeriesWorkbookInput');
    const file = input && input.files ? input.files[0] : null;
    if (!file) return showToast('Choose the averaged-series workbook', true);
    uploadAveragedSeriesWorkbook(file, {
      statusId: 'reportsAveragedSeriesImportStatus',
      inputId: 'reportsAveragedSeriesWorkbookInput',
      labelId: 'reportsAveragedSeriesWorkbookName'
    });
  }

  function updateBondAccountingPortfolioPicker() {
    const input = document.getElementById('bondAccountingPortfolioInput');
    const files = input && input.files ? [...input.files].filter(file => /\.(xlsm|xlsx|xls)$/i.test(file.name)) : [];
    const folderNames = [...new Set(files.map(file => String(file.webkitRelativePath || '').split('/')[0]).filter(Boolean))];
    const label = files.length
      ? `${formatNumber(files.length)} workbook${files.length === 1 ? '' : 's'}${folderNames.length ? ` from ${folderNames.slice(0, 2).join(', ')}` : ''}`
      : 'No folder selected';
    setText('bondAccountingPortfolioName', label);
  }

  function uploadBondAccountingImport() {
    const bankListInput = document.getElementById('bondAccountingBankListInput');
    const portfolioInput = document.getElementById('bondAccountingPortfolioInput');
    const status = document.getElementById('bondAccountingImportStatus');
    const bankListFile = bankListInput && bankListInput.files ? bankListInput.files[0] : null;
    const portfolioFiles = portfolioInput && portfolioInput.files
      ? [...portfolioInput.files].filter(file => /\.(xlsm|xlsx|xls)$/i.test(file.name))
      : [];
    if (!bankListFile) return showToast('Choose the bond-accounting bank list workbook', true);
    if (!portfolioFiles.length) return showToast('Choose the portfolio folder', true);
    const formData = new FormData();
    formData.append('bondBankList', bankListFile, bankListFile.name);
    portfolioFiles.forEach(file => formData.append('bondPortfolioFiles', file, file.name));
    if (status) status.textContent = `Importing ${formatNumber(portfolioFiles.length)} portfolio workbook${portfolioFiles.length === 1 ? '' : 's'}...`;
    fetch('/api/banks/bond-accounting/upload', { method: 'POST', body: formData })
      .then(async res => {
        const data = await readBankJson(res);
        bondAccountingManifest = data.manifest || null;
        const manifest = bondAccountingManifest || {};
        showToast(`Matched ${formatNumber(manifest.matchedCount || 0)} portfolio files`);
        renderBondAccountingMatches();
        return loadBankStatus();
      })
      .catch(err => {
        showToast(err.message, true);
        if (status) status.textContent = err.message;
      })
      .finally(() => {
        if (bankListInput) bankListInput.value = '';
        if (portfolioInput) portfolioInput.value = '';
        setText('bondAccountingBankListName', 'No workbook selected');
        setText('bondAccountingPortfolioName', 'No folder selected');
      });
  }

  function exportBondAccountingCsv() {
    if (!bondAccountingManifest) return showToast('No bond-accounting import to export', true);
    const rows = filteredBondAccountingRows();
    if (!rows.length) return showToast('No portfolio files match filters', true);
    const header = [
      'Status', 'Bank', 'PortfolioClient', 'PCode', 'FDICCert', 'ReportDate',
      'Account', 'Filename', 'MatchedBy', 'BankListClient', 'BankListAccount',
      'City', 'State', 'SalesRep', 'StoredPath'
    ];
    const csvRows = rows.map(row => {
      const bankList = row.bankList || {};
      return [
        bondAccountingStatusLabel(row),
        row.bankDisplayName || '',
        row.portfolioClientName || '',
        row.pCode || '',
        row.certNumber || '',
        row.reportDate || '',
        row.account || '',
        row.filename || '',
        row.matchedBy || '',
        bankList.clientName || '',
        bankList.account || '',
        bankList.city || '',
        bankList.state || '',
        bankList.salesRep || '',
        row.storedPath || ''
      ];
    });
    const fallbackStamp = new Date().toISOString().slice(0, 10);
    const stamp = (bondAccountingManifest.importedAt || fallbackStamp).slice(0, 10).replace(/[^0-9-]/g, '') || fallbackStamp;
    downloadCsv(`fbbs_bond_accounting_manifest_${stamp}.csv`, [header, ...csvRows]);
    showToast(`Exported ${formatNumber(rows.length)} bond-accounting rows`);
  }

  function exportPeerAnalysisCsv() {
    const bank = peerAnalysisState.bankData && peerAnalysisState.bankData.bank;
    const rows = peerAnalysisState.rows || [];
    if (!bank || !rows.length) return showToast('Build a peer analysis first', true);
    const latest = bank.periods && bank.periods[0] ? bank.periods[0] : {};
    const values = latest.values || {};
    const peerGroup = peerAnalysisState.peerGroup || {};
    const header = ['Bank', 'Cert', 'BankPeriod', 'PeerPeriod', 'PeerGroup', 'Metric', 'Section', 'BankValue', 'PeerValue', 'Delta', 'Signal', 'TalkingPoints'];
    const flagText = (peerAnalysisState.flags || []).map(flag => `${flag.title}: ${flag.detail}`).join(' | ');
    const csvRows = rows.map(row => [
      values.name || bank.summary.displayName || bank.summary.name || '',
      values.certNumber || bank.summary.certNumber || '',
      latest.period || '',
      peerAnalysisState.period || '',
      peerGroup.label || '',
      row.label,
      row.section,
      row.bankValue == null ? '' : row.bankValue,
      row.peerValue == null ? '' : row.peerValue,
      row.delta == null ? '' : row.delta,
      peerSignal(row),
      flagText
    ]);
    const filename = `fbbs_peer_analysis_${slugifyFilename(values.name || bank.summary.displayName || bank.id)}_${peerAnalysisState.period || latest.period || 'latest'}.csv`;
    downloadCsv(filename, [header, ...csvRows]);
    showToast('Exported peer analysis CSV');
  }

  // Reports Workspace v2 -------------------------------------------------
  function reportsRoute() {
    const parsed = parseHashTarget(window.location.hash || '#reports');
    return {
      subpath: parsed.page === 'reports' ? parsed.subpath : '',
      params: new URLSearchParams(parsed.query || '')
    };
  }

  function reportsHash(subpath, query) {
    const clean = String(subpath || '').replace(/^\/+/, '');
    const qs = query ? `?${query}` : '';
    return `#reports${clean ? '/' + clean : ''}${qs}`;
  }

  function reportBuildHash(type, reportId, extraParams = {}) {
    const params = new URLSearchParams();
    if (reportId) params.set('id', reportId);
    Object.entries(extraParams).forEach(([key, value]) => {
      if (value == null || value === '' || value === false) return;
      params.set(key, String(value));
    });
    return reportsHash(`build/${type || 'bank-peer'}`, params.toString());
  }

  function openBankReportBuilder(type, bankId = selectedBankId(), options = {}) {
    if (!bankId) {
      showToast('Choose a bank before building a report', true);
      return;
    }
    window.location.hash = reportBuildHash(type, '', {
      bankId,
      autorun: options.autorun === false ? '' : '1'
    });
  }

  function effectiveReportsRailId(route = reportsRoute()) {
    const path = route.subpath || '';
    if (path === 'data' || path === 'data/files') return 'folders-all';
    if (path.startsWith('build/') || path === 'new') return '';
    return reportRailItem(reportsActiveRail).id;
  }

  function loadReportsSessionReports() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem('fbbs.reports.sessionReports') || '[]');
      reportsSessionReports = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      reportsSessionReports = [];
    }
  }

  function saveReportsSessionReports() {
    try {
      sessionStorage.setItem('fbbs.reports.sessionReports', JSON.stringify(reportsSessionReports.slice(0, 25)));
    } catch (e) {
      // Session history is a convenience only.
    }
  }

  // Reports persistence moved server-side (see /api/reports). Saved definitions
  // and the hidden-ids list load from the server into the in-memory caches; the
  // render path stays synchronous against those caches and repaints when the
  // fetch resolves. Recent-run history (reportsSessionReports) stays in
  // sessionStorage — it is genuinely per-tab.
  async function loadReportsFromServer() {
    try {
      const res = await fetch('/api/reports', { cache: 'no-store' });
      const data = await readBankJson(res);
      savedReportDefinitions = Array.isArray(data.reports) ? data.reports : [];
      hiddenReportIds = Array.isArray(data.hidden) ? data.hidden.map(String) : [];
    } catch (e) {
      // Graceful: the workspace still renders fixtures + session rows.
      console.warn('Could not load reports from server:', e && e.message);
    }
  }

  // Hydrate once per session (load → one-time migration). Cached so concurrent
  // hashchanges during startup don't double-fetch.
  function ensureReportsLoaded() {
    if (!reportsLoadPromise) {
      reportsLoadPromise = loadReportsFromServer()
        .then(runReportsMigration)
        .catch(err => console.warn('Reports init failed:', err && err.message));
    }
    return reportsLoadPromise;
  }

  // POST (new) or PATCH (existing) a saved definition, then adopt the
  // server-returned row (authoritative id + timestamps + createdBy) into cache.
  async function persistReportDefinition(def) {
    const hasId = def.id && savedReportDefinitionById(def.id);
    const url = hasId ? `/api/reports/${encodeURIComponent(def.id)}` : '/api/reports';
    const res = await fetch(url, {
      method: hasId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(def)
    });
    const data = await readBankJson(res);
    const report = data.report;
    savedReportDefinitions = [report, ...savedReportDefinitions.filter(d => d.id !== report.id)];
    return report;
  }

  async function setReportHiddenOnServer(id, hidden) {
    const res = await fetch('/api/reports/hidden', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: String(id), hidden: Boolean(hidden) })
    });
    const data = await readBankJson(res);
    if (Array.isArray(data.hidden)) hiddenReportIds = data.hidden.map(String);
    return hiddenReportIds;
  }

  // One-time migration of legacy localStorage reports to the shared server.
  // Preserves ids (idempotent upsert), so a second machine migrating the same
  // export doesn't duplicate. Only clears localStorage on full success.
  async function runReportsMigration() {
    if (localStorage.getItem('fbbs.reports.migratedToServer') === '1') return;
    let legacyDefs = [];
    let legacyHidden = [];
    try { legacyDefs = JSON.parse(localStorage.getItem(SAVED_REPORTS_STORAGE_KEY) || '[]'); } catch (_) {}
    try { legacyHidden = JSON.parse(localStorage.getItem(HIDDEN_REPORTS_STORAGE_KEY) || '[]'); } catch (_) {}
    if (!Array.isArray(legacyDefs)) legacyDefs = [];
    if (!Array.isArray(legacyHidden)) legacyHidden = [];
    if (!legacyDefs.length && !legacyHidden.length) {
      localStorage.setItem('fbbs.reports.migratedToServer', '1');
      return;
    }
    try {
      for (const def of legacyDefs) {
        if (!def || !def.id) continue;
        await fetch('/api/reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(def)
        }).then(readBankJson);
      }
      for (const id of legacyHidden) {
        await fetch('/api/reports/hidden', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: String(id), hidden: true })
        }).then(readBankJson);
      }
      localStorage.removeItem(SAVED_REPORTS_STORAGE_KEY);
      localStorage.removeItem(HIDDEN_REPORTS_STORAGE_KEY);
      localStorage.setItem('fbbs.reports.migratedToServer', '1');
      await loadReportsFromServer();
      renderReportsWorkspace();
      showToast('Saved reports moved to the shared server');
    } catch (e) {
      // Leave localStorage intact so a later session retries.
      console.warn('Reports migration deferred:', e && e.message);
    }
  }

  function savedReportRows() {
    return savedReportDefinitions.map(def => ({
      id: def.id,
      name: def.name || 'Saved Bank List',
      type: def.type || 'custom-bank',
      folder: def.folder || 'Saved Views',
      description: def.description || reportTypeMeta(def.type || 'custom-bank').description,
      lastRunAt: def.updatedAt || def.createdAt,
      lastRunBy: 'You',
      pinned: Boolean(def.pinned),
      savedDefinition: true
    }));
  }

  function allReportsRows() {
    const seen = new Set();
    const hidden = new Set(hiddenReportIds);
    // Demo fixtures are first-run examples only: once a rep has any real saved
    // or session report, drop them so they aren't mistaken for live data.
    const showFixtures = savedReportDefinitions.length === 0 && reportsSessionReports.length === 0;
    const base = [...reportsSessionReports, ...savedReportRows()];
    const rows = showFixtures ? [...base, ...REPORT_FIXTURES] : base;
    return rows.filter(row => {
      if (!row || seen.has(row.id)) return false;
      if (hidden.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
  }

  async function deleteReportRow(reportId) {
    const id = String(reportId || '');
    const row = allReportsRows().find(item => item.id === id);
    if (!row) return showToast('Report not found', true);
    if (!window.confirm(`Delete "${row.name}" from Reports?`)) return;
    const inSession = reportsSessionReports.some(item => item.id === id);
    const inSaved = savedReportDefinitions.some(item => item.id === id);
    try {
      if (inSession) {
        reportsSessionReports = reportsSessionReports.filter(item => item.id !== id);
        saveReportsSessionReports();
      }
      if (inSaved) {
        await fetch(`/api/reports/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(readBankJson);
        savedReportDefinitions = savedReportDefinitions.filter(item => item.id !== id);
      }
      if (!inSession && !inSaved) {
        // Fixture / unknown id — dismiss it server-side so it stays hidden.
        await setReportHiddenOnServer(id, true);
      }
      // If the active rail is a custom folder that just lost its last report,
      // it vanishes from the rail — fall back to "recent" so the view isn't stuck
      // on a dangling empty folder.
      const active = reportRailItem(reportsActiveRail);
      if (active && active.folder && !allReportRailItems().some(item => item.id === reportsActiveRail)) {
        reportsActiveRail = 'recent';
        try { localStorage.setItem('fbbs.reports.lastRail', 'recent'); } catch (_) {}
      }
      renderReportsWorkspace();
      showToast('Deleted report');
    } catch (e) {
      showToast('Could not delete report', true);
    }
  }

  // Custom (rep-created) folders get a "custom-folder-" prefix so their rail ids
  // can never collide with the built-in REPORT_RAIL_ITEMS ids (folder-coverage,
  // folder-sales, …) even if a custom folder name slugifies to the same string.
  function customFolderRailId(folder) {
    const slug = String(folder).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return 'custom-folder-' + (slug || 'unnamed');
  }

  // Distinct folder names: the predefined rail folders plus any custom folder a
  // rep has assigned to a saved/session report (so "Move to folder…" with a new
  // name is effectively how you create a folder).
  function reportFolderNames() {
    const names = new Set();
    REPORT_RAIL_ITEMS.forEach(item => { if (item.folder) names.add(item.folder); });
    [...savedReportDefinitions, ...reportsSessionReports].forEach(d => { if (d && d.folder) names.add(d.folder); });
    return [...names];
  }

  // Predefined rail + any custom folders discovered on the data, so a report
  // moved into a brand-new folder name shows up as a navigable rail entry.
  function allReportRailItems() {
    const items = REPORT_RAIL_ITEMS.slice();
    const knownFolders = new Set(items.filter(i => i.folder).map(i => i.folder));
    const usedIds = new Set(items.map(i => i.id));
    [...savedReportDefinitions, ...reportsSessionReports].forEach(d => {
      if (!d || !d.folder || knownFolders.has(d.folder)) return;
      knownFolders.add(d.folder);
      // Guard against two distinct custom names slugifying to the same id.
      const base = customFolderRailId(d.folder);
      let id = base;
      let n = 2;
      while (usedIds.has(id)) { id = base + '-' + n++; }
      usedIds.add(id);
      items.push({ id, section: 'FOLDERS', label: d.folder, folder: d.folder });
    });
    return items;
  }

  function reportRailItem(id) {
    const items = allReportRailItems();
    return items.find(item => item.id === id) || items[0];
  }

  function reportTypeMeta(type) {
    return REPORT_TYPE_META[type] || REPORT_TYPE_META['bank-peer'];
  }

  function reportRelativeDate(iso) {
    if (!iso) return 'Never';
    const diffMs = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(diffMs)) return 'Recently';
    const mins = Math.max(1, Math.round(diffMs / 60000));
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return `${days}d ago`;
  }

  function reportAbsoluteDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString();
    } catch (e) {
      return '';
    }
  }

  function filterReportsRows() {
    const active = reportRailItem(reportsActiveRail);
    const search = reportsSearchQuery.trim().toLowerCase();
    let rows = allReportsRows();
    if (active.id === 'saved-views') rows = rows.filter(row => row.savedDefinition);
    if (active.id === 'pinned') rows = rows.filter(row => row.pinned);
    if (active.folder) rows = rows.filter(row => row.folder === active.folder);
    if (search) {
      rows = rows.filter(row => [row.name, row.description, row.folder, reportTypeMeta(row.type).name].filter(Boolean).join(' ').toLowerCase().includes(search));
    }
    rows = rows.slice().sort((a, b) => {
      const av = a[reportsSort.key] || '';
      const bv = b[reportsSort.key] || '';
      const cmp = String(av).localeCompare(String(bv));
      return reportsSort.dir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }

  function reportQuarterRank(period) {
    const m = String(period || '').trim().match(/^(\d{4})Q([1-4])$/i);
    if (!m) return null;
    return Number(m[1]) * 4 + Number(m[2]);
  }

  function reportsPeerFreshnessWarning(averagedMeta) {
    const bankMeta = bankDataStatus && bankDataStatus.metadata ? bankDataStatus.metadata : {};
    const bankPeriod = bankMeta.latestPeriod || '';
    const peerPeriod = averagedMeta && averagedMeta.latestPeriod ? averagedMeta.latestPeriod : '';
    const bankRank = reportQuarterRank(bankPeriod);
    const peerRank = reportQuarterRank(peerPeriod);
    if (bankRank === null || peerRank === null || peerRank >= bankRank) return '';
    return `Peer averages lag bank data: bank ${bankPeriod}, peer ${peerPeriod}. Re-import the averaged-series workbook before relying on peer comparisons.`;
  }

  function reportsFreshnessHtml() {
    const averaged = bankDataStatus && bankDataStatus.averagedSeries ? bankDataStatus.averagedSeries : {};
    const averagedMeta = averaged.metadata || {};
    const averagedDataset = averaged.dataset || {};
    const bond = bankDataStatus && bankDataStatus.bondAccounting ? bankDataStatus.bondAccounting : {};
    const bondCounts = bondAccountingReviewCounts(bond);
    const peerWarning = reportsPeerFreshnessWarning(averagedMeta);
    const peerText = averaged.available
      ? `Peer averages: ${escapeHtml(averagedMeta.latestPeriod || 'latest')} · imported ${escapeHtml(formatImportedDate(averagedMeta.importedAt))} · ${escapeHtml(formatNumber(averagedDataset.metricCount || averagedMeta.metricCount || 0))} metrics · ${escapeHtml(formatNumber(averagedDataset.seriesRowCount || averagedMeta.seriesRowCount || 0))} peer rows`
      : 'Peer averages: —';
    const bondText = bond.available
      ? `Portfolio files: ${escapeHtml(formatNumber(bondCounts.matched))} matched · ${escapeHtml(formatNumber(bondCounts.pCodeOnly))} P-code only · ${escapeHtml(formatNumber(bondCounts.unmatchedPCode))} unmatched P-code`
      : 'Portfolio files: —';
    return `
      <div class="reports-freshness">
        <a href="#reports/data">${peerText} <span>Manage</span></a>
        <a href="#reports/data/files">${bondText} <span>Manage</span></a>
        ${peerWarning ? `<div class="reports-freshness-warning">${escapeHtml(peerWarning)}</div>` : ''}
      </div>
    `;
  }

  function reportsLeftRailHtml() {
    let currentSection = '';
    const activeRailId = effectiveReportsRailId();
    return `
      <aside class="reports-left-rail" aria-label="Reports navigation">
        ${allReportRailItems().map(item => {
          const section = item.section !== currentSection ? (currentSection = item.section, `<h3>${escapeHtml(item.section)}</h3>`) : '';
          const cls = item.id === activeRailId ? 'active' : '';
          return `${section}<button type="button" class="${escapeHtml(cls)}" data-reports-rail="${escapeHtml(item.id)}">${escapeHtml(item.label)}</button>`;
        }).join('')}
      </aside>
    `;
  }

  function reportsHomeHtml() {
    const active = reportRailItem(reportsActiveRail);
    const rows = filterReportsRows();
    return `
      <div class="reports-layout">
        ${reportsLeftRailHtml()}
        <main class="reports-main">
          <header class="reports-page-head">
            <div>
              <span>Reports</span>
              <h3>${escapeHtml(active.label)}</h3>
              <p>${escapeHtml(formatNumber(rows.length))} item${rows.length === 1 ? '' : 's'}</p>
            </div>
            <div class="reports-head-actions">
              <input type="search" id="reportsSearchInput" placeholder="Search all reports..." value="${escapeHtml(reportsSearchQuery)}">
              <a class="small-btn" href="#reports/new">New Report</a>
              <button type="button" class="small-btn secondary" disabled title="Create a folder by choosing &quot;Move to folder…&quot; on a report and typing a new name">New Folder</button>
              <button type="button" class="icon-btn" disabled title="Available in Phase 1">⚙</button>
            </div>
          </header>
          ${reportsFreshnessHtml()}
          ${reportsListHtml(rows)}
        </main>
      </div>
    `;
  }

  function reportsListHtml(rows) {
    if (!rows.length) {
      return `
        <div class="reports-empty">
          <strong>No reports yet.</strong>
          <span>Click New Report to create one.</span>
          <a class="small-btn" href="#reports/new">New Report</a>
        </div>
      `;
    }
    const header = (key, label) => `<button type="button" data-reports-sort="${escapeHtml(key)}">${escapeHtml(label)}${reportsSort.key === key ? (reportsSort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button>`;
    return `
      <div class="reports-list-wrap">
        <table class="reports-list">
          <thead>
            <tr>
              <th>${header('name', 'Report Name')}</th>
              <th>Description</th>
              <th>${header('type', 'Type')}</th>
              <th>${header('folder', 'Folder')}</th>
              <th>${header('lastRunAt', 'Last Run')}</th>
              <th>Last Run By</th>
              <th>Subscribed</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => {
              const meta = reportTypeMeta(row.type);
              return `
                <tr data-report-id="${escapeHtml(row.id)}">
                  <td class="reports-name-cell" data-report-open="${escapeHtml(row.id)}" data-report-type="${escapeHtml(row.type)}"><a href="${escapeHtml(reportBuildHash(row.type, row.id))}">${escapeHtml(row.name)}</a></td>
                  <td><span class="reports-desc">${escapeHtml(row.description || meta.description)}</span></td>
                  <td><span class="reports-type-badge">${escapeHtml(meta.shortName)}</span></td>
                  <td>${escapeHtml(row.folder || 'Personal')}</td>
                  <td title="${escapeHtml(reportAbsoluteDate(row.lastRunAt))}">${escapeHtml(reportRelativeDate(row.lastRunAt))}</td>
                  <td>${escapeHtml(row.lastRunBy || 'You')}</td>
                  <td class="reports-sub-cell"></td>
                  <td>
                    <details class="reports-row-menu">
                      <summary aria-label="Report actions">⌄</summary>
                      <button type="button" data-report-action="run" data-report-type="${escapeHtml(row.type)}">Run</button>
                      ${row.savedDefinition ? `<button type="button" data-report-action="pin" data-report-id="${escapeHtml(row.id)}">${row.pinned ? 'Unpin' : 'Pin'}</button>` : ''}
                      ${row.savedDefinition ? `<button type="button" data-report-action="move" data-report-id="${escapeHtml(row.id)}">Move to folder…</button>` : ''}
                      <button type="button" data-report-action="duplicate" data-report-id="${escapeHtml(row.id)}">Duplicate</button>
                      <button type="button" class="reports-danger-action" data-report-action="delete" data-report-id="${escapeHtml(row.id)}">Delete</button>
                    </details>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function reportTypePickerHtml() {
    const categories = ['Recently Used', 'All', 'Bank Intelligence', 'Portfolio', 'Sales', 'Market Color', 'Billing & Ops', 'Other'];
    const types = Object.values(REPORT_TYPE_META);
    return `
      <div class="reports-modal-backdrop" role="presentation">
        <section class="reports-modal" role="dialog" aria-modal="true" aria-labelledby="reportsTypePickerTitle">
          <header>
            <h3 id="reportsTypePickerTitle">Create Report</h3>
            <a href="#reports" aria-label="Close">×</a>
          </header>
          <div class="reports-type-picker">
            <nav aria-label="Report type categories">
              ${categories.map((cat, idx) => `<button type="button" class="${idx === 0 ? 'active' : ''}" ${idx > 4 ? 'disabled title="Coming soon"' : ''}>${escapeHtml(cat)}</button>`).join('')}
            </nav>
            <main>
              <div class="reports-type-head">
                <h4>Select a Report Type</h4>
                <input type="search" id="reportsTypeSearchInput" placeholder="Search Report Types...">
                <button type="button" class="small-btn secondary" disabled>Filter report types (0)</button>
              </div>
              <div class="reports-type-results">
                ${types.map(type => `
                  <button type="button" class="reports-type-row" data-report-type-select="${escapeHtml(type.slug)}">
                    <span>
                      <strong>${escapeHtml(type.name)}</strong>
                      <small>${escapeHtml(type.description)}</small>
                    </span>
                    <em>${escapeHtml(type.category)}</em>
                  </button>
                `).join('')}
              </div>
              <footer>
                <a class="small-btn secondary" href="#reports">Cancel</a>
                <button type="button" class="small-btn" id="reportsTypeContinueBtn" disabled aria-disabled="true">Continue</button>
              </footer>
            </main>
          </div>
        </section>
      </div>
    `;
  }

  function savedReportDefinitionById(id) {
    return savedReportDefinitions.find(def => def.id === id) || null;
  }

  function customBankColumnDefs() {
    const datasetFields = customBankReportState.fields || [];
    const seen = new Set();
    return CUSTOM_BANK_REPORT_COLUMNS.map(col => {
      const field = datasetFields.find(f => f.key === col.key);
      seen.add(col.key);
      return field ? { ...col, label: col.label || field.label, type: col.type || field.type } : col;
    }).concat(datasetFields
      .filter(field => field && field.key && !seen.has(field.key))
      .map(field => ({ key: field.key, label: field.label || field.key, type: field.type || 'text', section: field.section || 'Other' }))
    );
  }

  function customBankColumnDef(key) {
    return customBankColumnDefs().find(col => col.key === key) || { key, label: key, type: 'text', section: 'Other' };
  }

  function customBankReportValue(row, key) {
    if (!row) return '';
    if (key === 'accountStatusLabel') return row.accountStatusLabel || (row.accountStatus && row.accountStatus.status) || 'Open';
    if (key === 'coverageOwner') return row.coverageOwner || (row.accountStatus && row.accountStatus.owner) || '';
    if (key === 'portfolioAvailable') return row.portfolioAvailable ? 'Yes' : 'No';
    return row[key];
  }

  function formatCustomBankReportValue(row, key) {
    const def = customBankColumnDef(key);
    const value = customBankReportValue(row, key);
    if (def.type === 'money') return formatCallReportValue(value, 'money');
    if (def.type === 'percent') return value == null || value === '' || isNaN(value) ? '—' : `${Number(value).toFixed(2)}%`;
    if (def.type === 'boolean') return value === true || value === 'Yes' ? 'Yes' : 'No';
    return value == null || value === '' ? '—' : String(value);
  }

  function numberFromInput(value) {
    const clean = String(value || '').replace(/[$,]/g, '').trim();
    if (!clean) return null;
    const n = Number(clean);
    return Number.isFinite(n) ? n : null;
  }

  function normalizeCustomBankReportRows(banks) {
    const portfolioCerts = new Set();
    const portfolioNames = new Set();
    const matches = bondAccountingManifest && Array.isArray(bondAccountingManifest.matches) ? bondAccountingManifest.matches : [];
    matches.forEach(row => {
      if (row.certNumber) portfolioCerts.add(String(row.certNumber));
      if (row.bankDisplayName) portfolioNames.add(String(row.bankDisplayName).toLowerCase());
    });
    return (Array.isArray(banks) ? banks : []).map(row => {
      const accountStatus = row.accountStatus || {};
      const name = row.displayName || row.name || '';
      const cert = row.certNumber == null ? '' : String(row.certNumber);
      return {
        ...row,
        displayName: name,
        accountStatusLabel: row.accountStatusLabel || accountStatus.status || 'Open',
        coverageOwner: accountStatus.owner || '',
        portfolioAvailable: portfolioCerts.has(cert) || portfolioNames.has(String(name).toLowerCase())
      };
    });
  }

  function customBankReportHasPeerWatch(row) {
    return ['peerDelta_yieldOnSecurities', 'peerDelta_netInterestMargin', 'peerDelta_liquidAssetsToAssets', 'peerDelta_securitiesToAssets']
      .some(key => {
        const value = Number(row[key]);
        if (!Number.isFinite(value)) return false;
        if (key === 'peerDelta_securitiesToAssets') return value < -3;
        return value < -0.15;
      });
  }

  function filteredCustomBankRows() {
    const filters = customBankReportState.filters;
    const search = String(filters.search || '').trim().toLowerCase();
    const states = new Set(String(filters.states || '').toUpperCase().split(/[\s,]+/).filter(Boolean));
    const statuses = new Set(String(filters.statuses || '').split(',').map(s => s.trim()).filter(Boolean));
    const minAssets = numberFromInput(filters.minAssets);
    const maxAssets = numberFromInput(filters.maxAssets);
    const rows = (customBankReportState.rows || []).filter(row => {
      if (search) {
        const haystack = [row.displayName, row.city, row.state, row.county, row.certNumber, row.coverageOwner, row.accountStatusLabel].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      if (states.size && !states.has(String(row.state || '').toUpperCase())) return false;
      if (statuses.size && !statuses.has(row.accountStatusLabel || 'Open')) return false;
      const assets = Number(row.totalAssets);
      if (minAssets != null && (!Number.isFinite(assets) || assets < minAssets * 1000)) return false;
      if (maxAssets != null && (!Number.isFinite(assets) || assets > maxAssets * 1000)) return false;
      if (filters.savedOnly && !(row.accountStatus && row.accountStatus.isCoverageSaved)) return false;
      if (filters.portfolioOnly && !row.portfolioAvailable) return false;
      if (filters.peerWatchOnly && !customBankReportHasPeerWatch(row)) return false;
      return true;
    });
    const sort = customBankReportState.sort || {};
    const key = sort.key || 'totalAssets';
    const dir = sort.dir === 'asc' ? 1 : -1;
    const sortDef = customBankColumnDef(key);
    return rows.slice().sort((a, b) => {
      const av = customBankReportValue(a, key);
      const bv = customBankReportValue(b, key);
      const an = Number(av);
      const bn = Number(bv);
      if (['money', 'percent', 'number'].includes(sortDef.type)) {
        const aOk = Number.isFinite(an);
        const bOk = Number.isFinite(bn);
        if (aOk && bOk) return (an - bn) * dir;
        if (aOk) return -1;
        if (bOk) return 1;
        return 0;
      }
      return String(av || '').localeCompare(String(bv || '')) * dir;
    });
  }

  function customBankReportFieldControl(field) {
    const filters = customBankReportState.filters;
    const checked = name => filters[name] ? 'checked' : '';
    if (field === 'status') {
      const options = ['Open', 'Prospect', 'Client', 'Watchlist', 'Dormant'];
      const selected = new Set(String(filters.statuses || '').split(',').filter(Boolean));
      return `
        <label>Status
          <select id="customBankStatusFilter" multiple size="5">
            ${options.map(opt => `<option value="${escapeHtml(opt)}" ${selected.has(opt) ? 'selected' : ''}>${escapeHtml(opt)}</option>`).join('')}
          </select>
        </label>
      `;
    }
    if (field === 'toggles') {
      return `
        <div class="custom-report-toggles">
          <label><input type="checkbox" id="customBankSavedOnly" ${checked('savedOnly')}> Saved banks only</label>
          <label><input type="checkbox" id="customBankPortfolioOnly" ${checked('portfolioOnly')}> Has portfolio file</label>
          <label><input type="checkbox" id="customBankPeerWatchOnly" ${checked('peerWatchOnly')}> Peer watch gaps</label>
        </div>
      `;
    }
    return '';
  }

  function customBankReportColumnPickerHtml() {
    const selected = new Set(customBankReportState.selectedColumns || []);
    const groups = {};
    customBankColumnDefs().forEach(col => {
      groups[col.section || 'Other'] = groups[col.section || 'Other'] || [];
      groups[col.section || 'Other'].push(col);
    });
    return Object.entries(groups).map(([section, cols]) => `
      <fieldset>
        <legend>${escapeHtml(section)}</legend>
        ${cols.map(col => `
          <label>
            <input type="checkbox" data-custom-bank-column="${escapeHtml(col.key)}" ${selected.has(col.key) ? 'checked' : ''}>
            ${escapeHtml(col.label)}
          </label>
        `).join('')}
      </fieldset>
    `).join('');
  }

  function customBankReportBuilderHtml() {
    const filters = customBankReportState.filters;
    const rows = filteredCustomBankRows();
    const source = customBankReportState.dataset || {};
    const peer = source.peerComparison || {};
    const selectedColumns = customBankReportState.selectedColumns || [];
    return `
      <div class="custom-report-builder">
        <div class="custom-report-grid">
          <label>Search
            <input type="search" id="customBankSearchInput" placeholder="Bank, city, cert, owner..." value="${escapeHtml(filters.search || '')}">
          </label>
          <label>States
            <input type="text" id="customBankStatesInput" placeholder="MO, IL, AR..." value="${escapeHtml(filters.states || '')}">
          </label>
          <label>Min assets ($MM)
            <input type="number" id="customBankMinAssetsInput" min="0" step="1" value="${escapeHtml(filters.minAssets || '')}">
          </label>
          <label>Max assets ($MM)
            <input type="number" id="customBankMaxAssetsInput" min="0" step="1" value="${escapeHtml(filters.maxAssets || '')}">
          </label>
          ${customBankReportFieldControl('status')}
          ${customBankReportFieldControl('toggles')}
        </div>
        <details class="custom-report-columns">
          <summary>Columns (${escapeHtml(formatNumber(selectedColumns.length))})</summary>
          <div>${customBankReportColumnPickerHtml()}</div>
        </details>
        <div class="custom-report-summary">
          <strong>${escapeHtml(formatNumber(rows.length))} banks</strong>
          <span>${escapeHtml(source.latestPeriod ? `Call report ${source.latestPeriod}` : 'Run the report to load bank data')}${peer.period ? escapeHtml(` · Peer ${peer.period}`) : ''}</span>
          <span>${escapeHtml(customBankReportState.lastRunAt ? `Generated ${new Date(customBankReportState.lastRunAt).toLocaleString()}` : '')}</span>
        </div>
        <div id="customBankReportOutput">${customBankReportOutputHtml(rows)}</div>
      </div>
    `;
  }

  function customBankReportOutputHtml(rows) {
    if (customBankReportState.loading) {
      return '<div class="bank-search-empty">Building custom bank report...</div>';
    }
    if (!customBankReportState.dataset) {
      return '<div class="bank-search-empty">Choose filters and run the report.</div>';
    }
    if (!rows.length) {
      return '<div class="bank-search-empty">No banks match the current report setup.</div>';
    }
    const columns = (customBankReportState.selectedColumns || []).map(customBankColumnDef);
    const top = rows.slice(0, 250);
    const header = col => `<button type="button" data-custom-bank-sort="${escapeHtml(col.key)}">${escapeHtml(col.label)}${customBankReportState.sort.key === col.key ? (customBankReportState.sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button>`;
    return `
      <div class="reports-list-wrap custom-report-table-wrap">
        <table class="reports-list custom-report-table">
          <thead><tr>${columns.map(col => `<th>${header(col)}</th>`).join('')}<th></th></tr></thead>
          <tbody>
            ${top.map(row => `
              <tr>
                ${columns.map(col => `<td>${escapeHtml(formatCustomBankReportValue(row, col.key))}</td>`).join('')}
                <td><button type="button" class="text-btn" data-custom-bank-open="${escapeHtml(row.id)}">Open</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ${rows.length > top.length ? `<div class="opp-more">Showing first ${escapeHtml(formatNumber(top.length))} of ${escapeHtml(formatNumber(rows.length))}. Tighten filters or export CSV for all rows.</div>` : ''}
    `;
  }

  function resetCustomBankReportFromDefinition(def) {
    if (!def) return;
    customBankReportState.definitionId = def.id || '';
    customBankReportState.name = def.name || '';
    customBankReportState.filters = { ...customBankReportState.filters, ...(def.filters || {}) };
    customBankReportState.selectedColumns = Array.isArray(def.columns) && def.columns.length ? def.columns.slice() : customBankReportState.selectedColumns;
    customBankReportState.sort = def.sort || customBankReportState.sort;
  }

  function renderCustomBankReportMount() {
    const mount = document.getElementById('reportsCustomBankMount');
    if (!mount) return;
    mount.innerHTML = customBankReportBuilderHtml();
  }

  async function runCustomBankReport() {
    customBankReportState.loading = true;
    renderCustomBankReportMount();
    try {
      const [data, manifest] = await Promise.all([
        fetch('/api/banks/map', { cache: 'no-store' }).then(readBankJson),
        bondAccountingManifest ? Promise.resolve(bondAccountingManifest) : fetch('/api/banks/bond-accounting', { cache: 'no-store' }).then(readBankJson).catch(() => null)
      ]);
      if (manifest) bondAccountingManifest = manifest;
      customBankReportState.dataset = data;
      customBankReportState.fields = Array.isArray(data.fields) ? data.fields : [];
      customBankReportState.rows = normalizeCustomBankReportRows(data.banks || []);
      customBankReportState.lastRunAt = new Date().toISOString();
      addSessionReport('custom-bank');
      showToast('Custom bank report ready');
    } catch (e) {
      showToast(e.message, true);
    } finally {
      customBankReportState.loading = false;
      renderCustomBankReportMount();
    }
  }

  function exportCustomBankReportCsv() {
    const rows = filteredCustomBankRows();
    if (!rows.length) return showToast('No report rows to export', true);
    const cols = (customBankReportState.selectedColumns || []).map(customBankColumnDef);
    const csvRows = rows.map(row => cols.map(col => formatCustomBankReportValue(row, col.key)));
    const stamp = (customBankReportState.dataset && customBankReportState.dataset.latestPeriod) || new Date().toISOString().slice(0, 10);
    downloadCsv(`custom_bank_report_${stamp}.csv`, [cols.map(col => col.label), ...csvRows]);
    showToast(`Exported ${formatNumber(rows.length)} banks`);
  }

  async function saveCustomBankReportDefinition() {
    const defaultName = customBankReportState.name || `Custom Bank List - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    const name = window.prompt('Name this saved view', defaultName);
    if (!name) return;
    // Server owns id (mints RP-YYYY-NNNN for new) + timestamps + createdBy.
    const def = {
      id: customBankReportState.definitionId || undefined,
      name: name.trim(),
      type: 'custom-bank',
      folder: 'Saved Views',
      description: 'Custom bank list saved from the report builder.',
      filters: { ...customBankReportState.filters },
      columns: customBankReportState.selectedColumns.slice(),
      sort: { ...customBankReportState.sort },
      pinned: true
    };
    try {
      const report = await persistReportDefinition(def);
      customBankReportState.definitionId = report.id;
      customBankReportState.name = report.name;
      showToast('Saved report view');
      renderReportsWorkspace();
    } catch (e) {
      showToast('Could not save report view', true);
    }
  }

  function builderFieldHtml(type) {
    if (type === 'custom-bank') return '<div id="reportsCustomBankMount"></div>';
    if (type === 'bank-peer') return '<div id="reportsBankPeerMount"></div>';
    if (type === 'portfolio-peer') return '<div id="reportsPortfolioReviewMount"></div>';
    if (type === 'opportunity') return '<div id="reportsOpportunityMount"></div>';
    if (type === 'coverage') return '<div id="reportsCoverageBookMount"></div>';
    if (type === 'billing-queue') return '<div id="reportsBillingQueueMount"></div>';
    return '<p class="reports-muted">Select a report type to begin.</p>';
  }

  function reportsBuilderHtml(type) {
    const meta = reportTypeMeta(type);
    return `
      <div class="reports-layout">
        ${reportsLeftRailHtml()}
        <main class="reports-main">
          <header class="reports-builder-head">
            <div>
              <span>Report Builder</span>
              <h3>${escapeHtml(meta.name)}</h3>
              <p>${escapeHtml(meta.description)}</p>
            </div>
            <a class="text-btn" href="#reports">Back to Reports</a>
          </header>
          ${reportsFreshnessHtml()}
          <section class="reports-builder-section">
            <h4>Inputs</h4>
            ${builderFieldHtml(type)}
          </section>
          <section class="reports-builder-section">
            <h4>Filters &amp; Grouping</h4>
            ${type === 'custom-bank'
              ? '<p class="reports-muted">Filters, column selection, and sorting are managed in the custom builder above.</p>'
              : type === 'opportunity' ? '<p class="reports-muted">Min flags, state, and saved-only filters are in the scan panel above.</p>'
              : type === 'billing-queue' ? '<p class="reports-muted">Search, request type, and assignee filters are in the billing queue panel above.</p>'
              : '<p class="reports-muted">No additional filters for this report type yet.</p>'}
          </section>
          <section class="reports-builder-section">
            <h4>Output</h4>
            <div class="reports-output-options">
              <label><input type="radio" name="reportsOutputFormat" value="view" checked> In-app view</label>
              <label><input type="radio" name="reportsOutputFormat" value="csv"> CSV</label>
              <label title="Coming soon"><input type="radio" name="reportsOutputFormat" value="xlsx" disabled> XLSX</label>
              <label${type === 'portfolio-peer' ? '' : ' title="Print/PDF is available for Portfolio Review"'}><input type="radio" name="reportsOutputFormat" value="pdf"${type === 'portfolio-peer' ? '' : ' disabled'}> Print / PDF</label>
            </div>
          </section>
          <footer class="reports-builder-footer">
            <a class="small-btn secondary" href="#reports">Cancel</a>
            <button type="button" class="small-btn secondary" data-reports-save-view="${escapeHtml(type)}" ${type === 'custom-bank' ? '' : 'disabled title="Available in Phase 1"'}>Save View</button>
            <button type="button" class="small-btn secondary" data-reports-export="${escapeHtml(type)}" ${['custom-bank', 'bank-peer', 'opportunity', 'portfolio-peer', 'billing-queue'].includes(type) ? '' : 'disabled title="Export not available for this report type yet"'}>Export CSV</button>
            <button type="button" class="small-btn secondary" disabled title="Available in Phase 3">Save &amp; Schedule</button>
            <button type="button" class="small-btn" data-reports-run="${escapeHtml(type)}">Run</button>
          </footer>
        </main>
      </div>
    `;
  }

  function reportsDataHtml(filesOnly) {
    return `
      <div class="reports-layout">
        ${reportsLeftRailHtml()}
        <main class="reports-main">
          <header class="reports-builder-head">
            <div>
              <span>Reports</span>
              <h3>${filesOnly ? 'Matched Portfolio Files' : 'Data Sources'}</h3>
              <p>${filesOnly ? 'Review the full bond-accounting file manifest.' : 'Manage the peer-average and portfolio sources that power reports.'}</p>
            </div>
            <a class="text-btn" href="#reports">Back to Reports</a>
          </header>
          ${reportsFreshnessHtml()}
          ${filesOnly ? '<section class="reports-builder-section"><div id="reportsFilesMount"></div></section>' : `
            <div class="reports-data-grid">
              <div id="reportsAveragedMount"></div>
              <div id="reportsBondMount"></div>
            </div>
            <section class="reports-builder-section">
              <header class="reports-section-inline-head">
                <h4>Matched portfolio files</h4>
                <a class="text-btn" href="#reports/data/files">Open full file list ›</a>
              </header>
              <div id="reportsFilesPreview"></div>
            </section>
          `}
        </main>
      </div>
    `;
  }

  function parkReportPanels() {
    const parking = document.getElementById('reportsPanelParking');
    if (!parking) return;
    ['averagedSeriesImportPanel', 'peerAnalysisBuilderPanel', 'opportunityReportPanel', 'bondAccountingImportPanel'].forEach(id => {
      const panel = document.getElementById(id);
      if (panel && panel.parentElement !== parking) parking.appendChild(panel);
    });
  }

  function mountReportPanel(id, mountId) {
    const mount = document.getElementById(mountId);
    const panel = document.getElementById(id);
    if (!mount || !panel) return;
    mount.appendChild(panel);
    panel.hidden = false;
  }

  function renderReportsFilesPreview() {
    const target = document.getElementById('reportsFilesPreview');
    if (!target) return;
    const rows = bondAccountingManifest && Array.isArray(bondAccountingManifest.matches) ? bondAccountingManifest.matches.slice(0, 5) : [];
    if (!rows.length) {
      target.innerHTML = '<div class="bank-search-empty">No portfolio files imported yet.</div>';
      return;
    }
    target.innerHTML = rows.map(row => `
      <div class="reports-match-row">
        <div><strong>${escapeHtml(row.bankDisplayName || row.portfolioClientName || row.filename || 'Portfolio file')}</strong><span>${escapeHtml([row.pCode, row.reportDate].filter(Boolean).join(' · '))}</span></div>
        <div><strong>${escapeHtml(bondAccountingStatusLabel(row))}</strong><small>${escapeHtml(row.filename || '')}</small></div>
        ${row.storedPath ? `<a class="text-btn" href="${bondAccountingFileUrl(row)}" target="_blank" rel="noopener">Open</a>` : '<span></span>'}
      </div>
    `).join('');
  }

  function renderReportsFilesTable() {
    const target = document.getElementById('reportsFilesMount');
    if (!target) return;
    const allRows = bondAccountingManifest && Array.isArray(bondAccountingManifest.matches) ? bondAccountingManifest.matches : [];
    const sortValue = row => {
      if (bondAccountingFileSort.key === 'bank') return row.bankDisplayName || row.portfolioClientName || '';
      if (bondAccountingFileSort.key === 'pCode') return row.pCode || '';
      if (bondAccountingFileSort.key === 'cert') return row.certNumber || '';
      if (bondAccountingFileSort.key === 'period') return row.reportDate || '';
      if (bondAccountingFileSort.key === 'status') return bondAccountingStatusLabel(row);
      return row.filename || '';
    };
    const rows = filteredBondAccountingRows().slice().sort((a, b) => {
      const cmp = String(sortValue(a)).localeCompare(String(sortValue(b)));
      return bondAccountingFileSort.dir === 'asc' ? cmp : -cmp;
    });
    const fileHeader = (key, label) => `<button type="button" data-reports-file-sort="${escapeHtml(key)}">${escapeHtml(label)}${bondAccountingFileSort.key === key ? (bondAccountingFileSort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button>`;
    target.innerHTML = `
      <div class="reports-files-sticky">
        <strong>Showing ${escapeHtml(formatNumber(rows.length))} of ${escapeHtml(formatNumber(allRows.length))} portfolio files</strong>
        <div class="reports-review-tools">
          <input type="search" id="reportsFilesSearchInput" placeholder="Search bank, P-code, cert, file" value="${escapeHtml(bondAccountingFilters.search || '')}">
          <select id="reportsFilesStatusFilter" aria-label="Bond accounting match status">
            <option value="">All statuses</option>
            <option value="matched" ${bondAccountingFilters.status === 'matched' ? 'selected' : ''}>Matched</option>
            <option value="needs-bank-data-match" ${bondAccountingFilters.status === 'needs-bank-data-match' ? 'selected' : ''}>P-code only</option>
            <option value="unmatched-pcode" ${bondAccountingFilters.status === 'unmatched-pcode' ? 'selected' : ''}>Unmatched P-code</option>
          </select>
          <button type="button" class="text-btn" id="reportsFilesExportBtn">Export CSV</button>
        </div>
      </div>
      ${rows.length ? `
        <div class="reports-list-wrap">
          <table class="reports-list reports-files-table">
            <thead><tr><th>${fileHeader('filename', 'File')}</th><th>${fileHeader('bank', 'Bank')}</th><th>${fileHeader('pCode', 'P-code')}</th><th>${fileHeader('cert', 'Cert')}</th><th>${fileHeader('period', 'Period')}</th><th>${fileHeader('status', 'Status')}</th><th></th></tr></thead>
            <tbody>${rows.map(row => `
              <tr>
                <td>${escapeHtml(row.filename || '')}</td>
                <td>${escapeHtml(row.bankDisplayName || row.portfolioClientName || '')}</td>
                <td>${escapeHtml(row.pCode || '')}</td>
                <td>${escapeHtml(row.certNumber || '')}</td>
                <td>${escapeHtml(row.reportDate || '')}</td>
                <td>${escapeHtml(bondAccountingStatusLabel(row))}</td>
                <td>${row.storedPath ? `<a class="text-btn" href="${bondAccountingFileUrl(row)}" target="_blank" rel="noopener">Open</a>` : ''}</td>
              </tr>
            `).join('')}</tbody>
          </table>
        </div>
      ` : '<div class="bank-search-empty">No portfolio files match the current filters.</div>'}
    `;
  }

  function portfolioReviewMetaLine(bank) {
    return [bank.city, bank.state, bank.certNumber ? `Cert ${bank.certNumber}` : '', bank.reportDate ? `Portfolio ${bank.reportDate}` : '', bank.accountStatus]
      .filter(Boolean).join(' · ');
  }

  function selectedPortfolioReviewBank() {
    const id = portfolioReviewState.selectedBankId;
    return (portfolioReviewState.banks || []).find(bank => bank.id === id) || null;
  }

  function portfolioReviewPickerSummary() {
    const bank = selectedPortfolioReviewBank();
    const review = portfolioReviewState.review || {};
    const name = (bank && bank.name) || review.bankName || 'Selected bank';
    const meta = bank ? portfolioReviewMetaLine(bank) : [review.city, review.state, review.certNumber ? `Cert ${review.certNumber}` : '', review.reportDate ? `Portfolio ${review.reportDate}` : ''].filter(Boolean).join(' · ');
    return `
      <div class="portfolio-review-picker-summary">
        <div>
          <span>Portfolio review ready</span>
          <strong>${escapeHtml(name)}</strong>
          ${meta ? `<em>${escapeHtml(meta)}</em>` : ''}
        </div>
        <button type="button" class="small-btn secondary" id="portfolioReviewChangeBankBtn">Change bank</button>
      </div>
    `;
  }

  function portfolioReviewBankOptions() {
    if (portfolioReviewState.loading && !portfolioReviewState.banks.length) {
      return '<div class="bank-search-empty">Loading banks with matched portfolio files...</div>';
    }
    if (!portfolioReviewState.banks.length) {
      return portfolioReviewState.search
        ? '<div class="bank-search-empty">No banks with matched portfolio files match that search.</div>'
        : '<div class="bank-search-empty">No matched portfolio files are available yet. Import bond-accounting files under Data Sources first.</div>';
    }
    const visible = portfolioReviewState.banks.slice(0, 80);
    return `
      <div class="portfolio-review-result-meta">
        ${escapeHtml(formatNumber(portfolioReviewState.banks.length))} matched bank${portfolioReviewState.banks.length === 1 ? '' : 's'}${portfolioReviewState.loading ? ' · refreshing...' : ''}
      </div>
      ${visible.map(bank => `
        <button type="button" class="reports-peer-result ${portfolioReviewState.selectedBankId === bank.id ? 'selected' : ''}" data-portfolio-bank="${escapeHtml(bank.id)}">
          <strong>${escapeHtml(bank.name || 'Bank')}</strong>
          <span>${escapeHtml(portfolioReviewMetaLine(bank))}</span>
        </button>
      `).join('')}
      ${portfolioReviewState.banks.length > visible.length ? `<div class="bank-search-empty">Showing first ${escapeHtml(formatNumber(visible.length))}; narrow the search to find more.</div>` : ''}
    `;
  }

  function portfolioReviewPanelHtml() {
    const canCollapsePicker = portfolioReviewState.review && portfolioReviewState.bankPickerCollapsed;
    return `
      <section class="portfolio-review-tool">
        ${canCollapsePicker ? portfolioReviewPickerSummary() : `
          <div class="reports-peer-search">
            <input type="search" id="portfolioReviewBankSearchInput" placeholder="Search banks with matched bond-accounting files..." value="${escapeHtml(portfolioReviewState.search || '')}" autocomplete="off">
            <button type="button" class="small-btn" id="portfolioReviewRefreshBanksBtn">Refresh</button>
          </div>
          <div class="portfolio-review-picker" id="portfolioReviewBankResults">${portfolioReviewBankOptions()}</div>
        `}
        <div class="portfolio-review-output" id="portfolioReviewOutput">
          ${portfolioReviewState.review ? portfolioReviewHtml(portfolioReviewState.review) : '<div class="bank-search-empty">Select a bank to build a portfolio review from its latest matched bond-accounting file.</div>'}
        </div>
      </section>
    `;
  }

  function restorePortfolioReviewSearchFocus(selectionStart, selectionEnd) {
    const input = document.getElementById('portfolioReviewBankSearchInput');
    if (!input) return;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(
      Number.isFinite(selectionStart) ? Math.min(selectionStart, end) : end,
      Number.isFinite(selectionEnd) ? Math.min(selectionEnd, end) : end
    );
  }

  async function loadPortfolioReviewBanks(query = '', options = {}) {
    const requestId = (portfolioReviewState.searchRequestId || 0) + 1;
    const activeInput = document.getElementById('portfolioReviewBankSearchInput');
    const shouldRestoreFocus = options.restoreFocus || (activeInput && document.activeElement === activeInput);
    const selectionStart = activeInput ? activeInput.selectionStart : null;
    const selectionEnd = activeInput ? activeInput.selectionEnd : null;
    portfolioReviewState.searchRequestId = requestId;
    portfolioReviewState.search = query || '';
    portfolioReviewState.loading = true;
    renderPortfolioReviewMount();
    if (shouldRestoreFocus) restorePortfolioReviewSearchFocus(selectionStart, selectionEnd);
    try {
      const qs = query ? `?q=${encodeURIComponent(query)}` : '';
      const res = await fetch(`/api/portfolio-review/eligible-banks${qs}`, { cache: 'no-store' });
      const data = await readBankJson(res);
      if (requestId !== portfolioReviewState.searchRequestId) return;
      portfolioReviewState.banks = Array.isArray(data.banks) ? data.banks : [];
      if (options.preferredBankId) {
        portfolioReviewState.selectedBankId = options.preferredBankId;
      } else if (!portfolioReviewState.selectedBankId && portfolioReviewState.banks[0]) {
        portfolioReviewState.selectedBankId = portfolioReviewState.banks[0].id;
      }
    } catch (e) {
      if (requestId !== portfolioReviewState.searchRequestId) return;
      portfolioReviewState.banks = [];
      showToast(e.message, true);
    } finally {
      if (requestId !== portfolioReviewState.searchRequestId) return;
      portfolioReviewState.loading = false;
      renderPortfolioReviewMount();
      if (shouldRestoreFocus) restorePortfolioReviewSearchFocus(selectionStart, selectionEnd);
    }
  }

  function renderPortfolioReviewMount() {
    const mount = document.getElementById('reportsPortfolioReviewMount');
    if (!mount) return;
    mount.innerHTML = portfolioReviewPanelHtml();
  }

  async function runPortfolioReview(bankId) {
    const id = bankId || portfolioReviewState.selectedBankId;
    if (!id) {
      showToast('Choose a bank with a matched portfolio file first', true);
      return;
    }
    portfolioReviewState.selectedBankId = id;
    portfolioReviewState.bankPickerCollapsed = true;
    const output = document.getElementById('portfolioReviewOutput');
    if (output) output.innerHTML = '<div class="bank-search-empty">Building portfolio review...</div>';
    try {
      const res = await fetch(`/api/portfolio-review?bankId=${encodeURIComponent(id)}&limit=8`, { cache: 'no-store' });
      portfolioReviewState.review = await readBankJson(res);
      portfolioReviewState.screen = 'topLosses';
      portfolioReviewState.holdingSector = 'All';
      portfolioReviewState.holdingSearch = '';
      portfolioReviewState.holdingSort = { key: 'marketValue', dir: 'desc' };
      renderPortfolioReviewMount();
      addSessionReport('portfolio-peer');
      showToast('Portfolio review ready');
    } catch (e) {
      if (output) output.innerHTML = `<div class="bank-search-empty">${escapeHtml(e.message)}</div>`;
      showToast(e.message, true);
    }
  }

  function portfolioMetricTile(label, value, detail, tone = '') {
    return `
      <div class="portfolio-review-tile ${escapeHtml(tone)}">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value || '—')}</strong>
        <em>${escapeHtml(detail || '')}</em>
      </div>
    `;
  }

  function formatReviewYield(value) {
    return value == null || isNaN(value) ? '—' : `${Number(value).toFixed(2)}%`;
  }

  function portfolioReviewHtml(data) {
    if (!data || data.available === false) {
      return `<div class="bank-search-empty">${escapeHtml(data && data.notice || 'No portfolio review available for this bank.')}</div>`;
    }
    const summary = data.summary || {};
    const gainTone = (summary.gainLoss || 0) < 0 ? 'warn' : 'good';
    const selectedScreen = portfolioReviewState.screen || 'topLosses';
    const screenRows = data.screens && Array.isArray(data.screens[selectedScreen]) ? data.screens[selectedScreen] : [];
    const screenDefs = [
      ['topLosses', 'Top Losses'],
      ['yieldReset', 'Yield Reset'],
      ['lowYield', 'Low Book Yield'],
      ['durationWatch', 'Duration'],
      ['callableWatch', 'Callable/Premium']
    ];
    return `
      <article class="portfolio-review-card">
        <header class="portfolio-review-head">
          <div>
            <span class="tool-eyebrow">Portfolio Review</span>
            <h3>${escapeHtml(data.bankName || 'Selected bank')}</h3>
            <p>${escapeHtml([data.city, data.state, data.certNumber ? `Cert ${data.certNumber}` : '', data.reportDate ? `Portfolio ${data.reportDate}` : '', data.inventoryDate ? `Inventory ${data.inventoryDate}` : ''].filter(Boolean).join(' · '))}</p>
          </div>
          <div class="portfolio-review-actions">
            <button type="button" class="small-btn secondary" data-portfolio-export="csv">Export CSV</button>
            <button type="button" class="small-btn secondary" data-portfolio-export="pdf">Print / PDF</button>
            <a class="text-btn" href="#strategies">Open Strategies</a>
            <a class="text-btn" href="#reports/data/files">Matched Files</a>
          </div>
        </header>
        <div class="portfolio-review-tiles">
          ${portfolioMetricTile('Market Value', formatMoney(summary.marketValue), `${formatNumber(summary.positions)} positions`)}
          ${portfolioMetricTile('Unrealized G/L', formatMoney(summary.gainLoss), formatPercentTile(summary.gainLossPct, 2), gainTone)}
          ${portfolioMetricTile('Book Yield', formatReviewYield(summary.bookYield), `Market ${formatReviewYield(summary.marketYield)}`)}
          ${portfolioMetricTile('WAL / Duration', [summary.weightedAverageLife != null ? summary.weightedAverageLife.toFixed(2) : null, summary.effectiveDuration != null ? summary.effectiveDuration.toFixed(2) : null].filter(Boolean).join(' / ') || '—', 'Weighted average')}
          ${portfolioMetricTile('Call Report', formatReviewYield(summary.yieldOnSecurities), `NIM ${formatReviewYield(summary.netInterestMargin)} · COF ${formatReviewYield(summary.costOfFunds)}`)}
          ${portfolioMetricTile('Tax Lens', data.isSubchapterS ? 'S-Corp' : 'C-Corp', `${formatReviewYield(data.taxRate)} assumed tax rate`)}
        </div>
        <section class="portfolio-review-section">
          <h4>Credibility Flags</h4>
          <div class="portfolio-review-flags">
            ${(data.flags || []).map(flag => `
              <div class="reports-peer-flag ${flag.severity === 'High' ? 'high' : ''}">
                <strong>${escapeHtml(flag.type || 'Flag')}</strong>
                <span>${escapeHtml(flag.text || '')}</span>
              </div>
            `).join('')}
          </div>
        </section>
        ${portfolioDecisionLayerHtml(data)}
        ${portfolioAnalyticsSection(data.analytics || {})}
        ${portfolioOpportunitiesHtml(data.opportunities || [])}
        <section class="portfolio-review-section portfolio-review-two-col">
          <div>
            <h4>Sector Mix</h4>
            ${portfolioSectorTable(data.sectors || [])}
          </div>
          <div>
            <h4>Maturity Ladder</h4>
            ${portfolioLadderHtml(data.ladder || [])}
          </div>
        </section>
        ${portfolioHoldingsBrowserHtml(data)}
        <section class="portfolio-review-section">
          <div class="portfolio-review-screen-head">
            <h4>Holdings Screens</h4>
            <div class="portfolio-review-tabs">
              ${screenDefs.map(([key, label]) => {
                const n = data.screens && Array.isArray(data.screens[key]) ? data.screens[key].length : 0;
                return `<button type="button" class="${key === selectedScreen ? 'active' : ''}" data-portfolio-screen="${escapeHtml(key)}">${escapeHtml(label)}<span class="portfolio-tab-count">${n}</span></button>`;
              }).join('')}
            </div>
          </div>
          ${portfolioHoldingsTable(screenRows)}
        </section>
        <section class="portfolio-review-section">
          <h4>Current-Inventory Swap Ideas</h4>
          ${portfolioSwapIdeasHtml(data.swapIdeas || [])}
        </section>
        <section class="portfolio-review-section">
          <h4>Assumptions</h4>
          <div class="portfolio-review-assumptions">
            ${(data.assumptions || []).map(item => `<span>${escapeHtml(item)}</span>`).join('')}
          </div>
        </section>
      </article>
    `;
	  }

  function portfolioDecisionLayerHtml(data) {
    const layer = data.decisionLayer || {};
    const commentary = Array.isArray(layer.commentary) ? layer.commentary : [];
    const priorities = Array.isArray(layer.priorities) ? layer.priorities : [];
    const actions = Array.isArray(layer.actions) ? layer.actions : [];
    if (!commentary.length && !priorities.length && !actions.length) return '';
    return `
      <section class="portfolio-review-section portfolio-decision-section">
        <div class="portfolio-review-screen-head">
          <h4>FBBS Action Readout</h4>
          <span class="portfolio-decision-source">THC analytics + call-report context</span>
        </div>
        <div class="portfolio-decision-grid">
          <div class="portfolio-decision-commentary">
            ${commentary.map(line => `<p>${escapeHtml(line)}</p>`).join('')}
          </div>
          <div class="portfolio-decision-priorities">
            ${priorities.length ? priorities.map(priority => `
              <span class="${priority.tone === 'High' ? 'high' : ''}">
                <strong>${escapeHtml(priority.title || 'Priority')}</strong>
                <em>${escapeHtml(priority.detail || '')}</em>
              </span>
            `).join('') : '<span><strong>No dominant issue</strong><em>Review holdings screens and sector mix before creating a task.</em></span>'}
          </div>
        </div>
        ${actions.length ? `
          <div class="portfolio-action-bar">
            ${actions.map(action => `
              <button type="button" class="small-btn ${action.type === 'strategy' ? 'primary' : ''}" data-portfolio-action="${escapeHtml(action.id)}">
                ${escapeHtml(action.label || 'Create Action')}
              </button>
            `).join('')}
          </div>
        ` : ''}
      </section>
    `;
  }

  function portfolioOpportunitiesHtml(rows) {
    if (!rows.length) return '';
    return `
      <section class="portfolio-review-section">
        <h4>Opportunity Worklist</h4>
        <div class="portfolio-opportunity-list">
          ${rows.map(row => `
            <article class="${row.severity === 'High' ? 'high' : ''}">
              <span>${escapeHtml(row.severity || 'Review')}</span>
              <strong>${escapeHtml(row.type || 'Opportunity')}</strong>
              <p>${escapeHtml(row.evidence || '')}</p>
              <em>${escapeHtml(row.nextStep || '')}</em>
            </article>
          `).join('')}
        </div>
      </section>
    `;
  }

  function formatShockLabel(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value || '');
    if (n === 0) return 'Base';
    return n > 0 ? `+${n}` : String(n);
  }

  function portfolioAnalyticsSection(analytics) {
    const scenarioRows = Array.isArray(analytics.scenarioSummary) ? analytics.scenarioSummary : [];
    const totalReturn = Array.isArray(analytics.totalReturn) ? analytics.totalReturn : [];
    const peerReview = Array.isArray(analytics.peerReview) ? analytics.peerReview : [];
    const krdRows = Array.isArray(analytics.keyRateDuration) ? analytics.keyRateDuration : [];
    if (!scenarioRows.length && !totalReturn.length && !peerReview.length && !krdRows.length) return '';
    return `
      <section class="portfolio-review-section portfolio-analytics-section">
        <h4>THC Scenario Analytics</h4>
        <div class="portfolio-analytics-grid">
          ${scenarioRows.length ? portfolioScenarioTable(scenarioRows) : ''}
          ${totalReturn.length ? portfolioTotalReturnTable(totalReturn) : ''}
          ${peerReview.length ? portfolioPeerReviewTable(peerReview) : ''}
          ${krdRows.length ? portfolioKeyRateTable(krdRows) : ''}
        </div>
      </section>
    `;
  }

  function portfolioScenarioTable(rows) {
    const visible = rows.filter(row => [-300, -100, 0, 100, 300].includes(Number(row.shock)));
    const displayRows = visible.length ? visible : rows.slice(0, 6);
    return `
      <div class="portfolio-analytics-card">
        <h5>Rate Shock Summary</h5>
        <table class="portfolio-mini-table">
          <thead><tr><th>Shock</th><th>MV</th><th>G/L</th><th>Price Chg</th><th>YTW</th></tr></thead>
          <tbody>${displayRows.map(row => `
            <tr>
              <td>${escapeHtml(formatShockLabel(row.shock))}</td>
              <td>${escapeHtml(formatMoney(row.marketValue))}</td>
              <td class="${(row.gainLoss || 0) < 0 ? 'reports-peer-delta-negative' : 'reports-peer-delta-positive'}">${escapeHtml(formatMoney(row.gainLoss))}</td>
              <td>${escapeHtml(formatPercentTile(row.priceChangePct, 2))}</td>
              <td>${escapeHtml(formatReviewYield(row.yieldToWorst))}</td>
            </tr>
          `).join('')}</tbody>
        </table>
      </div>
    `;
  }

  function portfolioTotalReturnTable(rows) {
    const investments = rows.find(row => /^investments$/i.test(row.sector)) || rows[0];
    const shocks = ['-300', '-100', '0', '100', '300'];
    return `
      <div class="portfolio-analytics-card">
        <h5>2-Year Total Return</h5>
        <table class="portfolio-mini-table">
          <thead><tr><th>Sector</th>${shocks.map(shock => `<th>${escapeHtml(formatShockLabel(shock))}</th>`).join('')}</tr></thead>
          <tbody>
            ${[investments].concat(rows.filter(row => !/^investments$/i.test(row.sector)).slice(0, 4)).filter(Boolean).map(row => `
              <tr>
                <td>${escapeHtml(row.sector || '')}</td>
                ${shocks.map(shock => `<td>${escapeHtml(formatPercentTile(row.returns && row.returns[shock], 2))}</td>`).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function portfolioPeerReviewTable(rows) {
    return `
      <div class="portfolio-analytics-card">
        <h5>Portfolio Peer Review</h5>
        <table class="portfolio-mini-table">
          <thead>
            <tr>
              <th rowspan="2">Sector</th>
              <th colspan="2" class="group-head">Allocation</th>
              <th colspan="2" class="group-head">Weighted Avg Coupon</th>
            </tr>
            <tr>
              <th>You</th>
              <th>Peer</th>
              <th>You</th>
              <th>Peer</th>
            </tr>
          </thead>
          <tbody>${rows.slice(0, 7).map(row => `
            <tr>
              <td>${escapeHtml(row.sector || '')}</td>
              <td>${escapeHtml(formatPercentTile(row.allocationPct, 2))}</td>
              <td>${escapeHtml(formatPercentTile(row.peerAllocationPct, 2))}</td>
              <td>${escapeHtml(formatPercentTile(row.weightedAverageCoupon, 2))}</td>
              <td>${escapeHtml(formatPercentTile(row.peerWeightedAverageCoupon, 2))}</td>
            </tr>
          `).join('')}</tbody>
        </table>
      </div>
    `;
  }

  function portfolioKeyRateTable(rows) {
    const investments = rows.find(row => /^investments$/i.test(row.label)) || rows[0];
    const labels = ['0.25', '1', '3', '5', '7', '10', '20', '30'].filter(key => investments && investments.values && investments.values[key] != null);
    const formatBucketLabel = key => {
      const n = Number(key);
      if (!Number.isFinite(n)) return key;
      if (n < 1) return `${(n * 12).toFixed(0)}M`;
      return `${n}Y`;
    };
    return `
      <div class="portfolio-analytics-card">
        <h5>Key Rate Duration</h5>
        <table class="portfolio-mini-table">
          <thead><tr><th>Sector</th>${labels.map(label => `<th>${escapeHtml(formatBucketLabel(label))}</th>`).join('')}</tr></thead>
          <tbody>
            ${rows.slice(0, 5).map(row => `
              <tr>
                <td>${escapeHtml(row.label || '')}</td>
                ${labels.map(label => `<td>${escapeHtml(row.values && row.values[label] != null ? Number(row.values[label]).toFixed(2) : '—')}</td>`).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function portfolioSectorTable(rows) {
    if (!rows.length) return '<div class="bank-search-empty">No sector rows parsed.</div>';
    return `
      <div class="reports-list-wrap compact portfolio-sector-wrap">
        <table class="reports-list portfolio-review-table portfolio-sector-table">
          <thead>
            <tr>
              <th>Sector</th>
              <th class="num">MV</th>
              <th class="num">Share</th>
              <th class="num">Book Yld</th>
              <th class="num">Mkt Yld</th>
              <th class="num">Dur</th>
              <th class="num">G/L</th>
            </tr>
          </thead>
          <tbody>${rows.map(row => `
            <tr>
              <td>
                <strong>${escapeHtml(row.sector || 'Other')}</strong>
                <span>${escapeHtml(formatNumber(row.count || 0))} position${row.count === 1 ? '' : 's'}</span>
              </td>
              <td class="num">${escapeHtml(formatMoney(row.marketValue))}</td>
              <td class="num">${escapeHtml(formatPercentTile(row.marketShare, 1))}</td>
              <td class="num">${escapeHtml(formatReviewYield(row.bookYield))}</td>
              <td class="num">${escapeHtml(formatReviewYield(row.marketYield))}</td>
              <td class="num">${row.effectiveDuration != null ? escapeHtml(row.effectiveDuration.toFixed(2)) : '<span class="muted-dash">—</span>'}</td>
              <td class="num ${(row.gainLoss || 0) < 0 ? 'reports-peer-delta-negative' : 'reports-peer-delta-positive'}">${escapeHtml(formatMoney(row.gainLoss))}</td>
            </tr>
          `).join('')}</tbody>
        </table>
      </div>
    `;
  }

  function portfolioLadderHtml(rows) {
    if (!rows.length) return '<div class="bank-search-empty">No dated maturities parsed.</div>';
    const max = Math.max(...rows.map(row => row.marketValue || row.par || 0), 1);
    return `
      <div class="portfolio-ladder">
        ${rows.map(row => {
          const width = Math.max(4, Math.round(((row.marketValue || row.par || 0) / max) * 100));
          return `
            <div class="portfolio-ladder-row">
              <span>${escapeHtml(row.year)}</span>
              <div><i style="width:${width}%"></i></div>
              <strong>${escapeHtml(formatMoney(row.marketValue || row.par))}</strong>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function portfolioHoldingSortValue(row, key) {
    if (!row) return '';
    if (key === 'description') return String(row.description || row.cusip || '').toLowerCase();
    if (key === 'sector') return String(row.sector || '').toLowerCase();
    if (key === 'maturity') return row.maturity || row.nextCall || '';
    if (key === 'coupon') return Number(row.coupon);
    if (key === 'marketPrice') return Number(row.marketPrice);
    if (key === 'par') return Number(row.par);
    if (key === 'marketYield') return Number(row.marketYield);
    if (key === 'effectiveDuration') return Number(row.effectiveDuration);
    if (key === 'averageLife') return Number(row.averageLife);
    if (key === 'gainLoss') return Number(row.gainLoss);
    return Number(row.marketValue);
  }

  function portfolioFilteredHoldings(data) {
    const rows = Array.isArray(data && data.holdings) ? data.holdings.slice() : [];
    const sector = portfolioReviewState.holdingSector || 'All';
    const query = String(portfolioReviewState.holdingSearch || '').trim().toLowerCase();
    const sort = portfolioReviewState.holdingSort || { key: 'marketValue', dir: 'desc' };
    return rows
      .filter(row => sector === 'All' || String(row.sector || 'Other') === sector)
      .filter(row => {
        if (!query) return true;
        return [
          row.cusip,
          row.description,
          row.sector,
          row.classification,
          row.maturity,
          row.nextCall
        ].some(value => String(value || '').toLowerCase().includes(query));
      })
      .sort((a, b) => {
        const av = portfolioHoldingSortValue(a, sort.key);
        const bv = portfolioHoldingSortValue(b, sort.key);
        const aNum = typeof av === 'number' && Number.isFinite(av);
        const bNum = typeof bv === 'number' && Number.isFinite(bv);
        let result;
        if (aNum || bNum) {
          result = (aNum ? av : -Infinity) - (bNum ? bv : -Infinity);
        } else {
          result = String(av || '').localeCompare(String(bv || ''));
        }
        return sort.dir === 'asc' ? result : -result;
      });
  }

  function portfolioHoldingSectorTabs(data) {
    const rows = Array.isArray(data && data.holdings) ? data.holdings : [];
    const counts = new Map();
    rows.forEach(row => counts.set(row.sector || 'Other', (counts.get(row.sector || 'Other') || 0) + 1));
    const sectors = [['All', rows.length]].concat(Array.from(counts.entries()).sort((a, b) => b[1] - a[1]));
    const active = portfolioReviewState.holdingSector || 'All';
    return `
      <div class="portfolio-holdings-sector-tabs">
        ${sectors.map(([sector, count]) => `
          <button type="button" class="${sector === active ? 'active' : ''}" data-portfolio-sector="${escapeHtml(sector)}">
            <span>${escapeHtml(sector)}</span>
            <em>${escapeHtml(formatNumber(count))}</em>
          </button>
        `).join('')}
      </div>
    `;
  }

  function portfolioHoldingsBrowserHtml(data) {
    const allRows = Array.isArray(data && data.holdings) ? data.holdings : [];
    if (!allRows.length) return '';
    const rows = portfolioFilteredHoldings(data);
    const marketValue = rows.reduce((sum, row) => sum + (Number(row.marketValue) || 0), 0);
    const par = rows.reduce((sum, row) => sum + (Number(row.par) || 0), 0);
    return `
      <section class="portfolio-review-section portfolio-holdings-browser">
        <div class="portfolio-review-screen-head">
          <div>
            <h4>Holdings Browser</h4>
            <p>${escapeHtml(formatNumber(rows.length))} of ${escapeHtml(formatNumber(allRows.length))} positions · ${escapeHtml(formatMoney(marketValue))} market value · ${escapeHtml(formatMoney(par))} par</p>
          </div>
          <input type="search" id="portfolioHoldingsSearchInput" value="${escapeHtml(portfolioReviewState.holdingSearch || '')}" placeholder="Search CUSIP, description, sector..." autocomplete="off">
        </div>
        ${portfolioHoldingSectorTabs(data)}
        ${portfolioHoldingsTable(rows, { browser: true })}
      </section>
    `;
  }

  function portfolioHoldingSortHeader(key, label, numeric = false) {
    const sort = portfolioReviewState.holdingSort || {};
    const active = sort.key === key;
    const marker = active ? (sort.dir === 'asc' ? ' asc' : ' desc') : '';
    return `<th class="${numeric ? 'num' : ''}"><button type="button" data-portfolio-holding-sort="${escapeHtml(key)}">${escapeHtml(label + marker)}</button></th>`;
  }

  function portfolioHoldingsTable(rows, options = {}) {
    if (!rows.length) return '<div class="bank-search-empty">No positions match this screen.</div>';
    const browser = Boolean(options.browser);
    return `
      <div class="reports-list-wrap portfolio-holdings-wrap">
        <table class="reports-list portfolio-review-table portfolio-holdings-table ${browser ? 'is-browser' : ''}">
          <thead>
            <tr>
              ${browser ? portfolioHoldingSortHeader('marketPrice', 'Price', true) : '<th>CUSIP</th>'}
              ${browser ? portfolioHoldingSortHeader('par', 'Par', true) : '<th>Description</th>'}
              ${browser ? portfolioHoldingSortHeader('sector', 'Sector') : '<th>Sector</th>'}
              ${browser ? '<th>CUSIP</th>' : '<th>Mat / Call</th>'}
              ${browser ? portfolioHoldingSortHeader('description', 'Description') : '<th class="num">Par</th>'}
              ${browser ? portfolioHoldingSortHeader('maturity', 'Maturity') : '<th class="num">Book Yld</th>'}
              ${browser ? portfolioHoldingSortHeader('coupon', 'CPN', true) : '<th class="num">Mkt Yld</th>'}
              ${browser ? portfolioHoldingSortHeader('effectiveDuration', 'Eff. Dur', true) : '<th class="num">G/L</th>'}
              ${browser ? portfolioHoldingSortHeader('averageLife', 'WAL', true) : '<th class="num">Dur</th>'}
              ${browser ? portfolioHoldingSortHeader('marketYield', 'Yield', true) : '<th class="num">WAL</th>'}
              ${browser ? portfolioHoldingSortHeader('gainLoss', 'G/L', true) : ''}
            </tr>
          </thead>
          <tbody>${rows.map(row => {
            const matCall = [row.maturity, row.nextCall ? `Call ${row.nextCall}` : ''].filter(Boolean).join(' / ');
            return browser ? `
            <tr>
              <td class="num">${row.marketPrice != null ? escapeHtml(Number(row.marketPrice).toFixed(3)) : '<span class="muted-dash">—</span>'}</td>
              <td class="num">${escapeHtml(formatMoney(row.par))}</td>
              <td>${escapeHtml(row.sector || '')}<span>${escapeHtml(row.classification || '')}</span></td>
              <td><code>${escapeHtml(row.cusip || '')}</code></td>
              <td><strong>${escapeHtml(row.description || 'Holding')}</strong>${row.nextCall ? `<span>Next call ${escapeHtml(row.nextCall)}</span>` : ''}</td>
              <td>${row.maturity ? escapeHtml(row.maturity) : '<span class="muted-dash">—</span>'}</td>
              <td class="num">${row.coupon != null ? escapeHtml(formatPercentTile(row.coupon, 2)) : '<span class="muted-dash">—</span>'}</td>
              <td class="num">${row.effectiveDuration != null ? escapeHtml(row.effectiveDuration.toFixed(2)) : '<span class="muted-dash">—</span>'}</td>
              <td class="num">${row.averageLife != null ? escapeHtml(row.averageLife.toFixed(2)) : '<span class="muted-dash">—</span>'}</td>
              <td class="num">${escapeHtml(formatReviewYield(row.marketYield))}</td>
              <td class="num ${(row.gainLoss || 0) < 0 ? 'reports-peer-delta-negative' : 'reports-peer-delta-positive'}">
                ${escapeHtml(formatMoney(row.gainLoss))}
                <small>${escapeHtml(formatPercentTile(row.gainLossPct, 2))}</small>
              </td>
            </tr>
          ` : `
            <tr>
              <td><code>${escapeHtml(row.cusip || '')}</code></td>
              <td><strong>${escapeHtml(row.description || 'Holding')}</strong><span>${escapeHtml(row.classification || '')}</span></td>
              <td>${escapeHtml(row.sector || '')}</td>
              <td>${matCall ? escapeHtml(matCall) : '<span class="muted-dash">—</span>'}</td>
              <td class="num">${escapeHtml(formatMoney(row.par))}</td>
              <td class="num">${escapeHtml(formatReviewYield(row.bookYield))}</td>
              <td class="num">${escapeHtml(formatReviewYield(row.marketYield))}</td>
              <td class="num ${(row.gainLoss || 0) < 0 ? 'reports-peer-delta-negative' : 'reports-peer-delta-positive'}">
                ${escapeHtml(formatMoney(row.gainLoss))}
                <small>${escapeHtml(formatPercentTile(row.gainLossPct, 2))}</small>
              </td>
              <td class="num">${row.effectiveDuration != null ? escapeHtml(row.effectiveDuration.toFixed(2)) : '<span class="muted-dash">—</span>'}</td>
              <td class="num">${row.averageLife != null ? escapeHtml(row.averageLife.toFixed(2)) : '<span class="muted-dash">—</span>'}</td>
            </tr>
          `;
          }).join('')}</tbody>
        </table>
      </div>
    `;
  }

	  function portfolioSwapIdeasHtml(rows) {
    if (!rows.length) {
      return '<div class="bank-search-empty">No current-inventory swap ideas passed the hard breakeven/maturity rule today.</div>';
    }
    return `
      <div class="portfolio-swap-grid">
        ${rows.map(row => `
          <article class="portfolio-swap-card">
            <span>${escapeHtml(row.sector || 'Swap')}</span>
            <strong>Sell ${escapeHtml(row.held && row.held.cusip || '')}</strong>
            <p>${escapeHtml(row.held && row.held.description || '')}</p>
            <div class="portfolio-swap-card-metrics">
              <b>${escapeHtml(formatReviewYield(row.held && row.held.bookYield))} book</b>
              <b>${escapeHtml(formatReviewYield(row.offering && row.offering.yield))} buy</b>
              <b>${escapeHtml(formatMoney(row.economics && row.economics.annualIncomePickup))} annual pickup</b>
              <b>${row.economics && row.economics.breakevenMonths != null ? escapeHtml(`${row.economics.breakevenMonths}mo breakeven`) : 'No loss breakeven'}</b>
            </div>
            <em>Buy: ${escapeHtml(row.offering && row.offering.label || '')}</em>
            ${(row.rule && row.rule.warnings || []).length ? `<small>${escapeHtml((row.rule.warnings || []).map(w => typeof w === 'string' ? w : (w && w.message) || '').filter(Boolean).join(' · '))}</small>` : ''}
          </article>
        `).join('')}
      </div>
    `;
	  }

  async function runPortfolioWorkflowAction(actionId) {
    const review = portfolioReviewState.review || {};
    const actions = review.decisionLayer && Array.isArray(review.decisionLayer.actions)
      ? review.decisionLayer.actions
      : [];
    const action = actions.find(row => row.id === actionId);
    if (!review.bankId || !action) return showToast('Choose a portfolio action first', true);
    try {
      if (action.type === 'product-fit') {
        const res = await fetch(`/api/banks/${encodeURIComponent(review.bankId)}/product-fit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product: action.product, notes: action.comments || action.summary || '' })
        });
        await readBankJson(res);
        bankIntelligenceCache.delete(String(review.bankId));
        showToast(`${action.product || 'Product fit'} flagged`);
        return;
      }

      const payload = {
        bankId: review.bankId,
        requestType: action.requestType || 'Miscellaneous',
        priority: action.priority || '3',
        requestedBy: meState.rep ? meState.rep.displayName : '',
        assignedTo: 'Strategies',
        summary: action.summary || action.label || 'Portfolio review follow-up',
        comments: action.comments || ''
      };
      const res = await fetch('/api/strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await readBankJson(res);
      if (data.request) {
        strategyRequests = [data.request, ...strategyRequests.filter(row => row.id !== data.request.id)];
        STRATEGY_STATUSES.forEach(status => {
          strategyCounts[status] = strategyRequests.filter(row => row.status === status).length;
        });
        loadStrategyNotifications();
      }
      showToast(`${action.requestType || 'Strategy'} request created`);
    } catch (err) {
      showToast(err.message || 'Could not create portfolio action', true);
    }
  }

  function addSessionReport(type) {
    const meta = reportTypeMeta(type);
    const bank = peerAnalysisState.bankData && peerAnalysisState.bankData.bank;
    const latest = bank && bank.periods && bank.periods[0] ? bank.periods[0] : {};
    const values = latest.values || {};
    const peerSubject = values.name || (bank && bank.summary && bank.summary.displayName);
    const portfolioSubject = portfolioReviewState.review && portfolioReviewState.review.bankName;
    const customSubject = type === 'custom-bank' && customBankReportState.rows && customBankReportState.rows.length
      ? ` - ${formatNumber(filteredCustomBankRows().length)} banks`
      : '';
    const subject = type === 'bank-peer' && peerSubject
      ? ` - ${peerSubject}`
      : type === 'portfolio-peer' && portfolioSubject
        ? ` - ${portfolioSubject}`
        : customSubject;
    reportsSessionReports.unshift({
      id: `session-${Date.now()}`,
      name: `${meta.name}${subject} - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      type,
      folder: meta.folder || 'Personal',
      description: meta.description,
      lastRunAt: new Date().toISOString(),
      lastRunBy: 'You',
      pinned: false
    });
    saveReportsSessionReports();
  }

  function renderReportsWorkspace() {
    const app = document.getElementById('reportsApp');
    if (!app) return;
    const route = reportsRoute();
    app.hidden = false;
    parkReportPanels();
    reportsSelectedType = '';
    const path = route.subpath || '';
    if (path === 'new') {
      app.innerHTML = reportsHomeHtml() + reportTypePickerHtml();
    } else if (path.startsWith('build/')) {
      const type = path.split('/')[1] || 'bank-peer';
      const bankId = route.params.get('bankId') || '';
      const autorun = route.params.get('autorun') === '1';
      let handledAutorun = false;
      app.innerHTML = reportsBuilderHtml(type);
      if (type === 'custom-bank') {
        const reportId = route.params.get('id') || '';
        if (reportId) resetCustomBankReportFromDefinition(savedReportDefinitionById(reportId));
        renderCustomBankReportMount();
      }
      if (type === 'bank-peer') {
        mountReportPanel('peerAnalysisBuilderPanel', 'reportsBankPeerMount');
        if (bankId) {
          const sameBank = peerAnalysisSelectedBankId() === bankId;
          if (!sameBank) {
            resetPeerAnalysisBuilder();
            handledAutorun = autorun;
            loadPeerAnalysisBank(bankId).then(() => {
              if (autorun && peerAnalysisSelectedBankId() === bankId) addSessionReport(type);
            });
          } else {
            renderPeerAnalysis();
            if (autorun) {
              addSessionReport(type);
              handledAutorun = true;
            }
          }
        } else if (!route.params.get('id')) {
          resetPeerAnalysisBuilder();
        }
      }
      if (type === 'portfolio-peer') {
        renderPortfolioReviewMount();
        if (bankId) {
          const needsFreshBankList = portfolioReviewState.search
            || !portfolioReviewState.banks.length
            || !portfolioReviewState.banks.some(bank => bank.id === bankId);
          portfolioReviewState.search = '';
          portfolioReviewState.selectedBankId = bankId;
          if (needsFreshBankList) {
            loadPortfolioReviewBanks('', { preferredBankId: bankId });
          }
          if (autorun) {
            handledAutorun = true;
            runPortfolioReview(bankId);
          }
        } else if (!portfolioReviewState.banks.length && !portfolioReviewState.loading) {
          loadPortfolioReviewBanks();
        }
      }
      if (type === 'opportunity') mountReportPanel('opportunityReportPanel', 'reportsOpportunityMount');
      if (type === 'coverage') renderCoverageBookMount();
      if (type === 'billing-queue') renderBillingQueueMount();
      if (autorun && !handledAutorun) setTimeout(() => runReportBuilder(type), 0);
    } else if (path === 'data/files') {
      app.innerHTML = reportsDataHtml(true);
      renderReportsFilesTable();
    } else if (path === 'data') {
      app.innerHTML = reportsDataHtml(false);
      mountReportPanel('averagedSeriesImportPanel', 'reportsAveragedMount');
      mountReportPanel('bondAccountingImportPanel', 'reportsBondMount');
      renderReportsFilesPreview();
    } else {
      app.innerHTML = reportsHomeHtml();
    }
  }

  // ===== Coverage Book report (Codex queue #3) =====
  // Assembled CLIENT-SIDE from existing APIs (no dedicated backend payload):
  //   GET /api/bank-coverage          → covered banks (status, owner, priority, period, assets)
  //   GET /api/strategies?archived=all → strategy-queue items, grouped by bank
  //   GET /api/bank-coverage/:bankId  → lazy per-bank detail (notes, contacts, product-fit) on expand
  // NOTE for Codex: this front-end does its own assembly; if you later add a
  // server Coverage report payload, swap loadCoverageBook() to read it instead.
  async function loadCoverageBook(force) {
    if (coverageBookState.loading) return;
    if (coverageBookState.loaded && !force) return;
    coverageBookState.loading = true;
    renderCoverageBookMount();
    try {
      const [covRes, sumRes] = await Promise.all([
        fetch('/api/bank-coverage', { cache: 'no-store' }),
        fetch('/api/strategies/summary', { cache: 'no-store' })
      ]);
      const cov = await readBankJson(covRes);
      const summary = await readBankJson(sumRes);
      coverageBookState.banks = Array.isArray(cov.savedBanks) ? cov.savedBanks : [];
      // Complete per-bank counts (uncapped) from the dedicated summary endpoint.
      coverageBookState.strategyCounts = (summary && summary.byBank) || {};
      coverageBookState.loaded = true;
    } catch (e) {
      showToast('Could not load coverage book: ' + (e && e.message || ''), true);
    } finally {
      coverageBookState.loading = false;
      renderCoverageBookMount();
    }
  }

  function coverageBookStrategyStats(bankId) {
    const c = coverageBookState.strategyCounts[bankId] || {};
    return { open: Number(c.open || 0), total: Number(c.total || 0) };
  }

  function coverageBookRows() {
    const q = coverageBookState.search.trim().toLowerCase();
    let rows = coverageBookState.banks.slice();
    if (q) {
      rows = rows.filter(b => [b.displayName, b.legalName, b.city, b.state, b.certNumber, b.owner, b.status]
        .filter(Boolean).join(' ').toLowerCase().includes(q));
    }
    return rows.sort((a, b) => String(a.displayName || '').localeCompare(String(b.displayName || '')));
  }

  async function loadCoverageBankDetail(bankId) {
    const cached = coverageBookState.detail[bankId];
    if (cached && !cached._failed) return; // re-fetch if the previous attempt failed
    try {
      const [covRes, stratRes] = await Promise.all([
        fetch('/api/bank-coverage/' + encodeURIComponent(bankId), { cache: 'no-store' }),
        fetch('/api/strategies?bankId=' + encodeURIComponent(bankId), { cache: 'no-store' })
      ]);
      const detail = await readBankJson(covRes);
      const strat = await readBankJson(stratRes);
      detail.strategies = (Array.isArray(strat.requests) ? strat.requests : []).filter(r => !r.isArchived);
      coverageBookState.detail[bankId] = detail;
    } catch (e) {
      coverageBookState.detail[bankId] = { _failed: true, notes: [], contacts: [], productFit: [], strategies: [] };
    }
    renderCoverageBookMount();
  }

  function coverageBookDetailHtml(bank) {
    const detail = coverageBookState.detail[bank.bankId];
    if (!detail) return '<div class="coverage-book-detail"><p class="cb-muted">Loading detail…</p></div>';
    if (detail._failed) return '<div class="coverage-book-detail"><p class="cb-muted">Couldn\'t load this bank\'s detail — collapse and expand to retry.</p></div>';
    const notes = Array.isArray(detail.notes) ? detail.notes : [];
    const contacts = Array.isArray(detail.contacts) ? detail.contacts : [];
    const fit = Array.isArray(detail.productFit) ? detail.productFit : [];
    const strategies = Array.isArray(detail.strategies) ? detail.strategies : [];
    return `
      <div class="coverage-book-detail">
        <div class="coverage-book-detail-grid">
          <section>
            <h5>Contacts (${contacts.length})</h5>
            ${contacts.length ? contacts.map(c => `<div class="cb-line"><strong>${escapeHtml(c.name)}</strong>${c.role ? ' · ' + escapeHtml(c.role) : ''}${c.phone ? ' · ' + escapeHtml(c.phone) : ''}${c.email ? ' · ' + escapeHtml(c.email) : ''}${c.isPrimary ? ' <span class="cb-tag">primary</span>' : ''}</div>`).join('') : '<p class="cb-muted">No contacts.</p>'}
          </section>
          <section>
            <h5>Product Fit (${fit.length})</h5>
            ${fit.length ? `<div class="cb-chips">${fit.map(f => `<span class="cb-chip">${escapeHtml(f.product)}</span>`).join('')}</div>` : '<p class="cb-muted">No product-fit flags.</p>'}
          </section>
          <section>
            <h5>Strategy Queue (${strategies.length})</h5>
            ${strategies.length ? strategies.map(s => `<div class="cb-line"><span class="bank-pill ${coverageClass(s.status)}">${escapeHtml(s.status)}</span> <strong>${escapeHtml(s.requestType)}</strong>${s.summary ? ' — ' + escapeHtml(s.summary) : ''}${s.assignedTo ? ' <em>(' + escapeHtml(s.assignedTo) + ')</em>' : ''}</div>`).join('') : '<p class="cb-muted">No strategy requests.</p>'}
          </section>
          <section>
            <h5>Notes (${notes.length})</h5>
            ${notes.length ? notes.slice(0, 6).map(n => `<div class="cb-line">${escapeHtml(n.text)}<span class="cb-muted"> · ${escapeHtml(formatShortDate(n.updatedAt || n.createdAt))}</span></div>`).join('') : '<p class="cb-muted">No notes.</p>'}
          </section>
        </div>
        <div class="coverage-book-detail-foot"><a class="text-btn" href="#banks" data-coverage-open="${escapeHtml(bank.bankId)}">Open tear sheet ›</a></div>
      </div>
    `;
  }

  function renderCoverageBookMount() {
    const mount = document.getElementById('reportsCoverageBookMount');
    if (!mount) return;
    if (!coverageBookState.loaded && !coverageBookState.loading) { loadCoverageBook(); return; }
    if (coverageBookState.loading && !coverageBookState.loaded) {
      mount.innerHTML = '<div class="bank-search-empty">Loading coverage book…</div>';
      return;
    }
    const rows = coverageBookRows();
    const total = coverageBookState.banks.length;
    const isFiltered = !!coverageBookState.search.trim() && rows.length !== total;
    // Totals reflect what's shown (filtered rows), consistent with the table and
    // the printout; the headline notes the full book size when a filter is active.
    const statusTotals = {};
    rows.forEach(b => { const s = b.status || 'Open'; statusTotals[s] = (statusTotals[s] || 0) + 1; });
    mount.innerHTML = `
      <article class="coverage-book">
        <header class="coverage-book-head">
          <div>
            <span class="tool-eyebrow">Coverage Book</span>
            <h3>${formatNumber(rows.length)} covered bank${rows.length === 1 ? '' : 's'}${isFiltered ? ` <span class="cb-muted" style="font-weight:400">of ${formatNumber(total)}</span>` : ''}</h3>
            <p>${Object.entries(statusTotals).map(([k, v]) => `${escapeHtml(k)}: ${v}`).join(' · ') || (total ? 'No banks match this search.' : 'No saved banks yet — add coverage from a bank tear sheet.')}</p>
          </div>
          <div class="coverage-book-actions">
            <input type="search" id="coverageBookSearch" placeholder="Search bank, owner, state, cert…" value="${escapeHtml(coverageBookState.search)}">
            <button type="button" class="small-btn secondary" data-coverage-export>Export CSV</button>
            <button type="button" class="small-btn secondary" data-coverage-print>Print / PDF</button>
          </div>
        </header>
        ${!rows.length ? '<div class="bank-search-empty">No covered banks match.</div>' : `
        <div class="reports-list-wrap">
          <table class="reports-list coverage-book-table">
            <thead><tr>
              <th>Bank</th><th>Status</th><th>Owner</th><th>Priority</th>
              <th>Location</th><th style="text-align:right">Assets</th>
              <th style="text-align:right">Strategies</th><th>Period</th><th></th>
            </tr></thead>
            <tbody>
              ${rows.map(b => {
                const stats = coverageBookStrategyStats(b.bankId);
                const expanded = coverageBookState.expanded.has(b.bankId);
                return `
                  <tr class="coverage-book-row${expanded ? ' expanded' : ''}">
                    <td><strong>${escapeHtml(b.displayName || b.legalName || b.bankId)}</strong></td>
                    <td><span class="bank-pill ${coverageClass(b.status)}">${escapeHtml(b.status || 'Open')}</span></td>
                    <td>${escapeHtml(b.owner || '—')}</td>
                    <td>${escapeHtml(b.priority || '—')}</td>
                    <td>${escapeHtml([b.city, b.state].filter(Boolean).join(', ') || '—')}</td>
                    <td style="text-align:right">${b.totalAssets != null ? formatMoney(b.totalAssets) : '—'}</td>
                    <td style="text-align:right">${stats.open}/${stats.total}</td>
                    <td>${escapeHtml(b.period || '—')}</td>
                    <td><button type="button" class="text-btn" data-coverage-expand="${escapeHtml(b.bankId)}">${expanded ? 'Hide' : 'Detail'}</button></td>
                  </tr>
                  ${expanded ? `<tr class="coverage-book-detail-row"><td colspan="9">${coverageBookDetailHtml(b)}</td></tr>` : ''}
                `;
              }).join('')}
            </tbody>
          </table>
        </div>`}
      </article>
    `;
  }

  function exportCoverageBookCsv() {
    const rows = coverageBookRows();
    if (!rows.length) return showToast('No covered banks to export', true);
    const out = [['Bank', 'Status', 'Owner', 'Priority', 'City', 'State', 'Cert', 'Assets', 'Deposits', 'Open Strategies', 'Total Strategies', 'Period', 'Next Action']];
    rows.forEach(b => {
      const stats = coverageBookStrategyStats(b.bankId);
      out.push([b.displayName || b.legalName || b.bankId, b.status || 'Open', b.owner || '', b.priority || '',
        b.city || '', b.state || '', b.certNumber || '', b.totalAssets, b.totalDeposits,
        stats.open, stats.total, b.period || '', b.nextActionDate || '']);
    });
    downloadCsv('coverage_book_' + new Date().toISOString().slice(0, 10) + '.csv', out);
  }

  // Client-side printable Coverage Book handout. Opens a clean standalone doc in
  // a popup and prints it from this (script-src 'self') context — no inline
  // script in the popup, so it sidesteps the strict-CSP inline-handler issue that
  // affects the server-rendered /render pages.
  function printCoverageBook() {
    const rows = coverageBookRows();
    if (!rows.length) return showToast('No covered banks to print', true);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    // Totals from the same (filtered) rows shown in the printout, matching screen.
    const statusTotals = {};
    rows.forEach(b => { const s = b.status || 'Open'; statusTotals[s] = (statusTotals[s] || 0) + 1; });
    const body = rows.map(b => {
      const st = coverageBookStrategyStats(b.bankId);
      return `<tr><td>${esc(b.displayName || b.legalName || b.bankId)}</td><td>${esc(b.status || 'Open')}</td><td>${esc(b.owner || '')}</td><td>${esc(b.priority || '')}</td><td>${esc([b.city, b.state].filter(Boolean).join(', '))}</td><td class="r">${b.totalAssets != null ? esc(formatMoney(b.totalAssets)) : ''}</td><td class="r">${st.open}/${st.total}</td><td>${esc(b.period || '')}</td></tr>`;
    }).join('');
    const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>FBBS Coverage Book</title><style>
      body{font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:#0f1f17;margin:24px;}
      header{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #0f1f17;padding-bottom:8px;margin-bottom:10px;}
      .firm{font-weight:800;text-transform:uppercase;letter-spacing:.04em;font-size:11px;}
      .firm strong{display:block;font-size:16px;text-transform:none;letter-spacing:0;}
      .totals{color:#4a5b53;font-size:11px;margin-bottom:10px;}
      table{width:100%;border-collapse:collapse;font-size:11px;}
      th,td{padding:4px 6px;border-bottom:1px solid #c8d6cd;text-align:left;}
      th{background:#f4f8f6;text-transform:uppercase;font-size:9.5px;letter-spacing:.04em;}
      .r{text-align:right;font-variant-numeric:tabular-nums;}
      footer{margin-top:18px;border-top:1px solid #c8d6cd;padding-top:8px;font-size:9.5px;color:#4a5b53;}
      @media print{@page{size:letter landscape;margin:.4in;}}
    </style></head><body>
      <header><div class="firm">First Bankers' Banc Securities, Inc.<strong>Coverage Book</strong></div><div style="font-size:11px;color:#4a5b53">${esc(dateStr)} &middot; ${rows.length} bank${rows.length === 1 ? '' : 's'}</div></header>
      <div class="totals">${Object.entries(statusTotals).map(([k, v]) => esc(k) + ': ' + v).join(' &middot; ')}</div>
      <table><thead><tr><th>Bank</th><th>Status</th><th>Owner</th><th>Priority</th><th>Location</th><th class="r">Assets</th><th class="r">Strategies</th><th>Period</th></tr></thead><tbody>${body}</tbody></table>
      <footer>For Institutional Use Only. Internal coverage summary. First Bankers' Banc Securities, Inc. is a member of FINRA / SIPC.</footer>
    </body></html>`;
    const w = window.open('', '_blank');
    if (!w) return showToast('Allow pop-ups to print the coverage book', true);
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch (e) {} }, 300);
  }

  function runCoverageBook() {
    loadCoverageBook(true);
  }

  // ===== Billing Queue report =====
  // Uses the canonical Strategies queue status. The source route already limits
  // results to active (non-archived) requests unless archived=all is passed.
  async function loadBillingQueue(force) {
    if (billingQueueState.loading) return;
    if (billingQueueState.loaded && !force) return;
    billingQueueState.loading = true;
    renderBillingQueueMount();
    try {
      const data = await fetch('/api/strategies?status=Needs%20Billed', { cache: 'no-store' }).then(readBankJson);
      billingQueueState.requests = Array.isArray(data.requests) ? data.requests : [];
      billingQueueState.counts = data.counts || {};
      billingQueueState.loaded = true;
    } catch (e) {
      showToast('Could not load billing queue: ' + (e && e.message || ''), true);
    } finally {
      billingQueueState.loading = false;
      renderBillingQueueMount();
    }
  }

  function billingQueueAgeDays(row) {
    const anchor = row && (row.billedAt || row.updatedAt || row.createdAt);
    if (!anchor) return null;
    const t = new Date(anchor).getTime();
    if (!Number.isFinite(t)) return null;
    return Math.max(0, Math.floor((Date.now() - t) / 86400000));
  }

  function billingQueueRows() {
    const q = billingQueueState.search.trim().toLowerCase();
    const type = billingQueueState.requestType;
    const owner = billingQueueState.assignedTo;
    return billingQueueState.requests
      .filter(row => {
        if (type && row.requestType !== type) return false;
        if (owner && (row.assignedTo || 'Unassigned') !== owner) return false;
        if (!q) return true;
        return [
          row.id, row.displayName, row.legalName, row.city, row.state, row.certNumber,
          row.requestType, row.priority, row.requestedBy, row.assignedTo,
          row.invoiceContact, row.summary, row.comments
        ].filter(Boolean).join(' ').toLowerCase().includes(q);
      })
      .sort((a, b) => {
        const ageDiff = (billingQueueAgeDays(b) || 0) - (billingQueueAgeDays(a) || 0);
        if (ageDiff) return ageDiff;
        return Number(a.priority || 9) - Number(b.priority || 9);
      });
  }

  function billingQueueOptions(key, fallback) {
    const values = new Set();
    billingQueueState.requests.forEach(row => values.add(row[key] || fallback));
    return [...values].filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)));
  }

  function billingQueueSummary(rows) {
    const aged = rows.map(billingQueueAgeDays).filter(n => n != null);
    const total = rows.length;
    const highPriority = rows.filter(row => Number(row.priority || 9) <= 2).length;
    const missingInvoice = rows.filter(row => !row.invoiceContact).length;
    const oldest = aged.length ? Math.max(...aged) : null;
    const byType = {};
    rows.forEach(row => {
      const type = row.requestType || 'Miscellaneous';
      byType[type] = (byType[type] || 0) + 1;
    });
    const topType = Object.entries(byType).sort((a, b) => b[1] - a[1])[0];
    return { total, highPriority, missingInvoice, oldest, topType };
  }

  function billingAgeClass(days) {
    if (days == null) return '';
    if (days >= 14) return 'billing-age-high';
    if (days >= 7) return 'billing-age-watch';
    return 'billing-age-fresh';
  }

  function renderBillingQueueMount() {
    const mount = document.getElementById('reportsBillingQueueMount');
    if (!mount) return;
    if (!billingQueueState.loaded && !billingQueueState.loading) { loadBillingQueue(); return; }
    if (billingQueueState.loading && !billingQueueState.loaded) {
      mount.innerHTML = '<div class="bank-search-empty">Loading billing queue...</div>';
      return;
    }
    const rows = billingQueueRows();
    const total = billingQueueState.requests.length;
    const summary = billingQueueSummary(rows);
    const requestTypes = billingQueueOptions('requestType', 'Miscellaneous');
    const assignees = billingQueueOptions('assignedTo', 'Unassigned');
    mount.innerHTML = `
      <article class="billing-queue-report">
        <header class="coverage-book-head">
          <div>
            <span>Billing &amp; Ops</span>
            <h3>Needs Billed</h3>
            <p>${escapeHtml(formatNumber(rows.length))} of ${escapeHtml(formatNumber(total))} active request${total === 1 ? '' : 's'} waiting on billing</p>
          </div>
          <div class="coverage-book-actions">
            <input type="search" id="billingQueueSearch" placeholder="Search bank, owner, invoice..." value="${escapeHtml(billingQueueState.search)}">
            <select id="billingQueueTypeFilter" aria-label="Billing request type">
              <option value="">All request types</option>
              ${requestTypes.map(type => `<option value="${escapeHtml(type)}" ${billingQueueState.requestType === type ? 'selected' : ''}>${escapeHtml(type)}</option>`).join('')}
            </select>
            <select id="billingQueueAssigneeFilter" aria-label="Billing assignee">
              <option value="">All assignees</option>
              ${assignees.map(owner => `<option value="${escapeHtml(owner)}" ${billingQueueState.assignedTo === owner ? 'selected' : ''}>${escapeHtml(owner)}</option>`).join('')}
            </select>
            <button type="button" class="small-btn secondary" data-billing-export>Export CSV</button>
            <button type="button" class="small-btn secondary" data-billing-open-queue>Open Strategies</button>
          </div>
        </header>
        <div class="reports-readiness billing-queue-summary">
          <div><strong>${escapeHtml(formatNumber(summary.total))}</strong><span>Needs billed</span></div>
          <div><strong>${escapeHtml(formatNumber(summary.highPriority))}</strong><span>Priority 1-2</span></div>
          <div><strong>${summary.oldest == null ? '—' : escapeHtml(String(summary.oldest))}</strong><span>Oldest age days</span></div>
          <div><strong>${escapeHtml(formatNumber(summary.missingInvoice))}</strong><span>Missing invoice contact</span></div>
          <div><strong>${escapeHtml(summary.topType ? summary.topType[0] : '—')}</strong><span>Largest request type${summary.topType ? ` (${escapeHtml(formatNumber(summary.topType[1]))})` : ''}</span></div>
        </div>
        ${rows.length ? `
          <div class="reports-list-wrap">
            <table class="reports-list billing-queue-table">
              <thead>
                <tr>
                  <th>Bank</th>
                  <th>Request</th>
                  <th>Owner</th>
                  <th>Invoice Contact</th>
                  <th>Priority</th>
                  <th>Age</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(row => {
                  const days = billingQueueAgeDays(row);
                  return `
                    <tr>
                      <td><strong>${escapeHtml(row.displayName || row.legalName || 'Bank')}</strong><span class="reports-desc">${escapeHtml([row.city, row.state, row.certNumber ? `Cert ${row.certNumber}` : ''].filter(Boolean).join(' · '))}</span></td>
                      <td><strong>${escapeHtml(row.requestType || 'Miscellaneous')}</strong><span class="reports-desc">${escapeHtml(row.summary || '')}</span></td>
                      <td>${escapeHtml(row.assignedTo || 'Unassigned')}</td>
                      <td>${escapeHtml(row.invoiceContact || '—')}</td>
                      <td>${escapeHtml(row.priority || '3')}</td>
                      <td><span class="billing-age ${billingAgeClass(days)}">${days == null ? '—' : `${escapeHtml(String(days))}d`}</span></td>
                      <td>${escapeHtml(formatFullTimestamp(row.updatedAt || row.billedAt || row.createdAt))}</td>
                      <td><button type="button" class="text-btn" data-billing-open-bank="${escapeHtml(row.bankId || '')}">Open</button></td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        ` : '<div class="bank-search-empty">No active billing requests match those filters.</div>'}
      </article>
    `;
  }

  function runBillingQueue() {
    loadBillingQueue(true);
    addSessionReport('billing-queue');
  }

  function exportBillingQueueCsv() {
    const rows = billingQueueRows();
    if (!rows.length) return showToast('No billing rows to export', true);
    const out = [[
      'Bank', 'Legal Name', 'City', 'State', 'Cert', 'Request Type', 'Summary',
      'Priority', 'Requested By', 'Assigned To', 'Invoice Contact',
      'Needs Billed Since', 'Age Days', 'Updated', 'Comments'
    ]];
    rows.forEach(row => out.push([
      row.displayName || '',
      row.legalName || '',
      row.city || '',
      row.state || '',
      row.certNumber || '',
      row.requestType || '',
      row.summary || '',
      row.priority || '',
      row.requestedBy || '',
      row.assignedTo || '',
      row.invoiceContact || '',
      row.billedAt || '',
      billingQueueAgeDays(row),
      row.updatedAt || '',
      row.comments || ''
    ]));
    downloadCsv('billing_queue_' + new Date().toISOString().slice(0, 10) + '.csv', out);
    showToast(`Exported ${formatNumber(rows.length)} billing rows`);
  }

  function setupReportsAppEvents() {
    if (reportsAppEventsBound) return;
    reportsAppEventsBound = true;
    document.addEventListener('input', event => {
      const target = event.target;
      if (!target) return;
      if (target.id === 'reportsSearchInput') {
        reportsSearchQuery = target.value || '';
        renderReportsWorkspace();
        const nextInput = document.getElementById('reportsSearchInput');
        if (nextInput) {
          nextInput.focus();
          nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
        }
      }
      if (target.id === 'reportsFilesSearchInput') {
        bondAccountingFilters.search = target.value || '';
        renderReportsFilesTable();
        const nextInput = document.getElementById('reportsFilesSearchInput');
        if (nextInput) {
          nextInput.focus();
          nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
        }
      }
      if (target.id === 'reportsTypeSearchInput') {
        const query = String(target.value || '').trim().toLowerCase();
        document.querySelectorAll('.reports-type-row').forEach(row => {
          row.hidden = query && !row.textContent.toLowerCase().includes(query);
        });
      }
      if (target.id === 'portfolioReviewBankSearchInput') {
        clearTimeout(portfolioReviewState.searchTimer);
        portfolioReviewState.searchTimer = setTimeout(() => loadPortfolioReviewBanks(target.value || ''), 250);
      }
      if (target.id === 'portfolioHoldingsSearchInput') {
        portfolioReviewState.holdingSearch = target.value || '';
        renderPortfolioReviewMount();
        const nextInput = document.getElementById('portfolioHoldingsSearchInput');
        if (nextInput) {
          nextInput.focus();
          nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
        }
      }
      if (target.id === 'coverageBookSearch') {
        coverageBookState.search = target.value || '';
        renderCoverageBookMount();
        const nextInput = document.getElementById('coverageBookSearch');
        if (nextInput) {
          nextInput.focus();
          nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
        }
      }
      if (target.id === 'billingQueueSearch') {
        billingQueueState.search = target.value || '';
        renderBillingQueueMount();
        const nextInput = document.getElementById('billingQueueSearch');
        if (nextInput) {
          nextInput.focus();
          nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
        }
      }
      if (['customBankSearchInput', 'customBankStatesInput', 'customBankMinAssetsInput', 'customBankMaxAssetsInput'].includes(target.id)) {
        const keyById = {
          customBankSearchInput: 'search',
          customBankStatesInput: 'states',
          customBankMinAssetsInput: 'minAssets',
          customBankMaxAssetsInput: 'maxAssets'
        };
        customBankReportState.filters[keyById[target.id]] = target.value || '';
        renderCustomBankReportMount();
        const nextInput = document.getElementById(target.id);
        if (nextInput) {
          nextInput.focus();
          nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
        }
      }
    });
    document.addEventListener('keydown', event => {
      const target = event.target;
      if (!target) return;
      if (target.id === 'portfolioReviewBankSearchInput' && event.key === 'Enter') {
        event.preventDefault();
        const firstBank = portfolioReviewState.banks && portfolioReviewState.banks[0];
        if (firstBank) runPortfolioReview(firstBank.id);
      }
    });
    document.addEventListener('change', event => {
      const target = event.target;
      if (!target) return;
      if (target.id === 'reportsFilesStatusFilter') {
        bondAccountingFilters.status = target.value || '';
        renderReportsFilesTable();
      }
      if (target.id === 'customBankStatusFilter') {
        customBankReportState.filters.statuses = Array.from(target.selectedOptions || []).map(opt => opt.value).join(',');
        renderCustomBankReportMount();
      }
      if (target.id === 'billingQueueTypeFilter') {
        billingQueueState.requestType = target.value || '';
        renderBillingQueueMount();
      }
      if (target.id === 'billingQueueAssigneeFilter') {
        billingQueueState.assignedTo = target.value || '';
        renderBillingQueueMount();
      }
      if (target.id === 'customBankSavedOnly') {
        customBankReportState.filters.savedOnly = Boolean(target.checked);
        renderCustomBankReportMount();
      }
      if (target.id === 'customBankPortfolioOnly') {
        customBankReportState.filters.portfolioOnly = Boolean(target.checked);
        renderCustomBankReportMount();
      }
      if (target.id === 'customBankPeerWatchOnly') {
        customBankReportState.filters.peerWatchOnly = Boolean(target.checked);
        renderCustomBankReportMount();
      }
      if (target.matches && target.matches('[data-custom-bank-column]')) {
        const key = target.dataset.customBankColumn;
        const selected = new Set(customBankReportState.selectedColumns || []);
        if (target.checked) selected.add(key);
        else selected.delete(key);
        customBankReportState.selectedColumns = [...selected];
        if (!customBankReportState.selectedColumns.length) customBankReportState.selectedColumns = ['displayName'];
        renderCustomBankReportMount();
      }
    });
    document.addEventListener('click', event => {
      const clickTarget = event.target && event.target.closest ? event.target : event.target?.parentElement;
      if (!clickTarget) return;
      const rail = clickTarget.closest('[data-reports-rail]');
      if (rail) {
        reportsActiveRail = rail.dataset.reportsRail || 'recent';
        localStorage.setItem('fbbs.reports.lastRail', reportsActiveRail);
        renderReportsWorkspace();
        return;
      }
      const sorter = clickTarget.closest('[data-reports-sort]');
      if (sorter) {
        const key = sorter.dataset.reportsSort;
        if (reportsSort.key === key) {
          reportsSort.dir = reportsSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          reportsSort = { key, dir: key === 'lastRunAt' ? 'desc' : 'asc' };
        }
        renderReportsWorkspace();
        return;
      }
      const fileSorter = clickTarget.closest('[data-reports-file-sort]');
      if (fileSorter) {
        const key = fileSorter.dataset.reportsFileSort;
        if (bondAccountingFileSort.key === key) {
          bondAccountingFileSort.dir = bondAccountingFileSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          bondAccountingFileSort = { key, dir: 'asc' };
        }
        renderReportsFilesTable();
        return;
      }
      const typeRow = clickTarget.closest('[data-report-type-select]');
      if (typeRow) {
        reportsSelectedType = typeRow.dataset.reportTypeSelect || '';
        document.querySelectorAll('.reports-type-row.selected').forEach(row => row.classList.remove('selected'));
        typeRow.classList.add('selected');
        const continueBtn = document.getElementById('reportsTypeContinueBtn');
        if (continueBtn) {
          continueBtn.disabled = !reportsSelectedType;
          continueBtn.setAttribute('aria-disabled', reportsSelectedType ? 'false' : 'true');
        }
        return;
      }
      const continueBtn = clickTarget.closest('#reportsTypeContinueBtn');
      if (continueBtn && reportsSelectedType) {
        event.preventDefault();
        const recent = JSON.parse(localStorage.getItem('fbbs.reports.recentTypes') || '[]').filter(type => type !== reportsSelectedType);
        recent.unshift(reportsSelectedType);
        localStorage.setItem('fbbs.reports.recentTypes', JSON.stringify(recent.slice(0, 6)));
        window.location.hash = reportsHash(`build/${reportsSelectedType}`);
        return;
      }
      const runBtn = clickTarget.closest('[data-reports-run]');
      if (runBtn) {
        runReportBuilder(runBtn.dataset.reportsRun);
        return;
      }
      const saveViewBtn = clickTarget.closest('[data-reports-save-view]');
      if (saveViewBtn && saveViewBtn.dataset.reportsSaveView === 'custom-bank') {
        saveCustomBankReportDefinition();
        return;
      }
      const exportBtn = clickTarget.closest('[data-reports-export]');
      if (exportBtn) {
        exportReport(exportBtn.dataset.reportsExport, 'csv');
        return;
      }
      const customSort = clickTarget.closest('[data-custom-bank-sort]');
      if (customSort) {
        const key = customSort.dataset.customBankSort;
        if (customBankReportState.sort.key === key) {
          customBankReportState.sort.dir = customBankReportState.sort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          customBankReportState.sort = { key, dir: 'asc' };
        }
        renderCustomBankReportMount();
        return;
      }
      const customOpen = clickTarget.closest('[data-custom-bank-open]');
      if (customOpen) {
        goTo('banks');
        loadBank(customOpen.dataset.customBankOpen, { collapseResults: true });
        return;
      }
      const reportOpen = clickTarget.closest('[data-report-open]');
      if (reportOpen) {
        event.preventDefault();
        window.location.hash = reportBuildHash(reportOpen.dataset.reportType || 'bank-peer', reportOpen.dataset.reportOpen || '');
        return;
      }
      const rowAction = clickTarget.closest('[data-report-action]');
      if (rowAction) {
        const action = rowAction.dataset.reportAction;
        if (action === 'run') {
          window.location.hash = reportBuildHash(rowAction.dataset.reportType || 'bank-peer', rowAction.closest('tr')?.dataset.reportId || '', { autorun: '1' });
        }
        if (action === 'pin') {
          const def = savedReportDefinitionById(rowAction.dataset.reportId);
          if (def) {
            persistReportDefinition({ id: def.id, pinned: !def.pinned })
              .then(() => { renderReportsWorkspace(); showToast(def.pinned ? 'Unpinned' : 'Pinned'); })
              .catch(() => showToast('Could not update pin', true));
          }
        }
        if (action === 'move') {
          const def = savedReportDefinitionById(rowAction.dataset.reportId);
          if (def) {
            const existing = reportFolderNames().join(', ');
            const target = window.prompt(`Move "${def.name}" to which folder?\nExisting: ${existing}\n(Type a new name to create a folder.)`, def.folder || 'Personal');
            if (target && target.trim() && target.trim() !== def.folder) {
              persistReportDefinition({ id: def.id, folder: target.trim() })
                .then(() => { renderReportsWorkspace(); showToast('Moved to ' + target.trim()); })
                .catch(() => showToast('Could not move report', true));
            }
          }
        }
        if (action === 'duplicate') {
          const def = savedReportDefinitionById(rowAction.dataset.reportId);
          if (def) {
            // Saved report → persist a server-side copy so it survives reloads.
            persistReportDefinition({
              name: `${def.name} (Copy)`, type: def.type, folder: def.folder,
              description: def.description, filters: def.filters, columns: def.columns,
              sort: def.sort, pinned: false
            })
              .then(() => { renderReportsWorkspace(); showToast('Duplicated report'); })
              .catch(() => showToast('Could not duplicate', true));
          } else {
            const source = allReportsRows().find(row => row.id === rowAction.dataset.reportId);
            if (source) {
              reportsSessionReports.unshift({ ...source, id: `session-${Date.now()}`, name: `${source.name} (Copy)`, lastRunAt: new Date().toISOString(), lastRunBy: 'You' });
              saveReportsSessionReports();
              renderReportsWorkspace();
              showToast('Duplicated report');
            }
          }
        }
        if (action === 'delete') {
          deleteReportRow(rowAction.dataset.reportId || rowAction.closest('tr')?.dataset.reportId || '');
        }
        return;
      }
      if (clickTarget.closest('#reportsFilesExportBtn')) {
        exportBondAccountingCsv();
      }
      const coverageExpand = clickTarget.closest('[data-coverage-expand]');
      if (coverageExpand) {
        const id = coverageExpand.dataset.coverageExpand;
        if (coverageBookState.expanded.has(id)) {
          coverageBookState.expanded.delete(id);
        } else {
          coverageBookState.expanded.add(id);
          loadCoverageBankDetail(id);
        }
        renderCoverageBookMount();
        return;
      }
      if (clickTarget.closest('[data-coverage-export]')) {
        exportCoverageBookCsv();
        return;
      }
      if (clickTarget.closest('[data-coverage-print]')) {
        printCoverageBook();
        return;
      }
      if (clickTarget.closest('[data-billing-export]')) {
        exportBillingQueueCsv();
        return;
      }
      if (clickTarget.closest('[data-billing-open-queue]')) {
        goTo('strategies');
        const statusFilter = document.getElementById('strategyArchiveFilter');
        if (statusFilter) statusFilter.value = '';
        loadStrategies();
        return;
      }
      const billingOpen = clickTarget.closest('[data-billing-open-bank]');
      if (billingOpen) {
        event.preventDefault();
        goTo('banks');
        loadBank(billingOpen.dataset.billingOpenBank, { collapseResults: true });
        return;
      }
      const coverageOpen = clickTarget.closest('[data-coverage-open]');
      if (coverageOpen) {
        event.preventDefault();
        goTo('banks');
        loadBank(coverageOpen.dataset.coverageOpen, { collapseResults: true });
        return;
      }
      const portfolioBank = clickTarget.closest('[data-portfolio-bank]');
      if (portfolioBank) {
        runPortfolioReview(portfolioBank.dataset.portfolioBank);
        return;
      }
      if (clickTarget.closest('#portfolioReviewChangeBankBtn')) {
        portfolioReviewState.bankPickerCollapsed = false;
        renderPortfolioReviewMount();
        return;
      }
      const portfolioExport = clickTarget.closest('[data-portfolio-export]');
      if (portfolioExport) {
        exportReport('portfolio-peer', portfolioExport.dataset.portfolioExport === 'pdf' ? 'pdf' : 'csv');
        return;
      }
      const portfolioScreen = clickTarget.closest('[data-portfolio-screen]');
      if (portfolioScreen) {
        portfolioReviewState.screen = portfolioScreen.dataset.portfolioScreen || 'topLosses';
        renderPortfolioReviewMount();
        return;
      }
      const portfolioSector = clickTarget.closest('[data-portfolio-sector]');
      if (portfolioSector) {
        portfolioReviewState.holdingSector = portfolioSector.dataset.portfolioSector || 'All';
        renderPortfolioReviewMount();
        return;
      }
      const portfolioHoldingSort = clickTarget.closest('[data-portfolio-holding-sort]');
      if (portfolioHoldingSort) {
        const key = portfolioHoldingSort.dataset.portfolioHoldingSort || 'marketValue';
        const current = portfolioReviewState.holdingSort || {};
        portfolioReviewState.holdingSort = {
          key,
          dir: current.key === key && current.dir === 'desc' ? 'asc' : 'desc'
        };
        renderPortfolioReviewMount();
        return;
      }
      const portfolioAction = clickTarget.closest('[data-portfolio-action]');
      if (portfolioAction) {
        runPortfolioWorkflowAction(portfolioAction.dataset.portfolioAction || '');
        return;
      }
      if (clickTarget.closest('#portfolioReviewRefreshBanksBtn')) {
        const input = document.getElementById('portfolioReviewBankSearchInput');
        loadPortfolioReviewBanks(input ? input.value : '');
        return;
      }
    });
  }

  function runReportBuilder(type) {
    const outputFormat = (document.querySelector('input[name="reportsOutputFormat"]:checked') || {}).value || 'view';
    if (type === 'custom-bank') {
      if (outputFormat === 'csv' && customBankReportState.dataset) {
        exportCustomBankReportCsv();
        return;
      }
      runCustomBankReport();
      return;
    }
    if (type === 'bank-peer') {
      const input = document.getElementById('peerAnalysisBankSearchInput');
      const hasBank = peerAnalysisState.bankData && peerAnalysisState.rows && peerAnalysisState.rows.length;
      setPeerAnalysisValidation('');
      if (!hasBank && input && input.value.trim()) {
        searchPeerAnalysisBanks(input.value, { openFirst: true }).then(() => addSessionReport(type));
      } else if (hasBank) {
        renderPeerAnalysis();
        addSessionReport(type);
        showToast(outputFormat === 'csv' ? 'Report ready; use Export Analysis for CSV' : 'Bank Peer Analysis refreshed');
      } else {
        setPeerAnalysisValidation('Choose a bank before running the report.');
        const inputPanel = document.getElementById('peerAnalysisBankSearchInput');
        if (inputPanel) inputPanel.focus();
      }
      return;
    }
    if (type === 'opportunity') {
      runOpportunityScan().then(() => addSessionReport(type));
      return;
    }
    if (type === 'portfolio-peer') {
      if (outputFormat === 'csv') { exportReport('portfolio-peer', 'csv'); return; }
      if (outputFormat === 'pdf') { exportReport('portfolio-peer', 'pdf'); return; }
      runPortfolioReview();
      return;
    }
    if (type === 'coverage') {
      runCoverageBook();
      addSessionReport(type);
    }
    if (type === 'billing-queue') {
      runBillingQueue();
    }
  }
  // ----------------------------------------------------------------------

  async function loadStrategies() {
    const board = document.getElementById('strategyBoard');
    const archive = document.getElementById('strategyArchiveFilter');
    const archived = archive ? archive.value : '';
    const qs = archived ? `?archived=${encodeURIComponent(archived)}` : '';
    if (board) board.innerHTML = '<div class="bank-search-empty">Loading strategy requests&hellip;</div>';
    try {
      const res = await fetch(`/api/strategies${qs}`, { cache: 'no-store' });
      const data = await readBankJson(res);
      strategyRequests = Array.isArray(data.requests) ? data.requests : [];
      strategyCounts = data.counts || {};
      renderStrategyBoard();
    } catch (e) {
      strategyRequests = [];
      strategyCounts = {};
      renderStrategyBoard(e.message);
    }
  }

  async function loadStrategyNotifications() {
    try {
      const res = await fetch('/api/strategies', { cache: 'no-store' });
      const data = await readBankJson(res);
      strategyNotifications = {
        requests: Array.isArray(data.requests) ? data.requests : [],
        counts: data.counts || {}
      };
    } catch (e) {
      strategyNotifications = { requests: [], counts: {} };
    }
    const filled = packageUploadedCount(currentPackage);
    renderHomeWorkList(filled);
    renderHomeLaunchGrid();
    if (typeof renderHomeTileStrategies === 'function') renderHomeTileStrategies();
  }

  function filteredStrategies() {
    const search = document.getElementById('strategySearchInput');
    const type = document.getElementById('strategyTypeFilter');
    const q = String(search ? search.value : '').trim().toLowerCase();
    const typeFilter = String(type ? type.value : '').trim();
    return strategyRequests.filter(row => {
      if (typeFilter && row.requestType !== typeFilter) return false;
      if (!q) return true;
      return [
        row.id, row.displayName, row.legalName, row.city, row.state, row.certNumber,
        row.requestType, row.status, row.priority, row.requestedBy,
        row.assignedTo, row.invoiceContact, row.summary, row.comments,
        ...(Array.isArray(row.files) ? row.files.map(file => file.filename || file.label || '') : []),
        row.createdAt, row.updatedAt, row.completedAt, row.billedAt, row.archivedAt
      ].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
  }

  function renderStrategyBoard(errorMessage) {
    const board = document.getElementById('strategyBoard');
    const countsEl = document.getElementById('strategyCounts');
    const openCount = document.getElementById('strategiesOpenCount');
    const sub = document.getElementById('strategiesSub');
    const archive = document.getElementById('strategyArchiveFilter');
    const archivedMode = archive ? archive.value : '';
    if (!board) return;
    if (openCount) openCount.textContent = formatNumber(archivedMode === 'only' ? (strategyCounts.Archived || 0) : (strategyCounts.Open || 0));
    if (sub) {
      const total = strategyRequests.length;
      const scope = archivedMode === 'only' ? 'archived' : archivedMode === 'all' ? 'total' : 'active';
      sub.textContent = `${formatNumber(total)} ${scope} ${total === 1 ? 'request' : 'requests'} across the Strategies workflow`;
    }
    if (countsEl) {
      countsEl.innerHTML = STRATEGY_STATUSES.map(status => `
        <span class="strategy-count-pill">
          ${escapeHtml(status)}
          <strong>${formatNumber(strategyCounts[status] || 0)}</strong>
        </span>
      `).join('') + `
        <span class="strategy-count-pill">
          Archived
          <strong>${formatNumber(strategyCounts.Archived || 0)}</strong>
        </span>
      `;
    }
    if (errorMessage) {
      board.innerHTML = `<div class="bank-search-empty">${escapeHtml(errorMessage)}</div>`;
      return;
    }
    const rows = filteredStrategies();
    if (!strategyRequests.length) {
      board.innerHTML = archivedMode === 'only'
        ? '<div class="bank-search-empty">No archived strategy requests yet.</div>'
        : '<div class="bank-search-empty">No strategy requests yet. Open a bank tear sheet and submit the first request.</div>';
      return;
    }
    if (!rows.length) {
      board.innerHTML = '<div class="bank-search-empty">No strategy requests match those filters.</div>';
      return;
    }
    board.innerHTML = STRATEGY_STATUSES.map(status => {
      const items = rows.filter(row => row.status === status);
      return `
        <section class="strategy-column">
          <div class="strategy-column-head">
            <h3>${escapeHtml(status)}</h3>
            <span>${formatNumber(items.length)}</span>
          </div>
          <div class="strategy-column-list">
            ${items.length ? items.map(renderStrategyCard).join('') : '<div class="strategy-empty-column">Nothing here right now.</div>'}
          </div>
        </section>
      `;
    }).join('');
    board.querySelectorAll('[data-strategy-update]').forEach(btn => {
      btn.addEventListener('click', () => updateStrategyStatus(btn.dataset.strategyUpdate, btn.dataset.strategyStatus));
    });
    board.querySelectorAll('[data-strategy-edit]').forEach(btn => {
      btn.addEventListener('click', () => showStrategyEditor(btn.dataset.strategyEdit));
    });
    board.querySelectorAll('[data-strategy-save]').forEach(btn => {
      btn.addEventListener('click', () => saveStrategyEditor(btn.dataset.strategySave));
    });
    board.querySelectorAll('[data-strategy-upload]').forEach(btn => {
      btn.addEventListener('click', () => uploadStrategyFile(btn.dataset.strategyUpload));
    });
    wireStrategyDropZones(board);
    board.querySelectorAll('[data-strategy-cancel]').forEach(btn => {
      btn.addEventListener('click', () => hideStrategyEditor(btn.dataset.strategyCancel));
    });
    board.querySelectorAll('[data-strategy-archive]').forEach(btn => {
      btn.addEventListener('click', () => archiveStrategyRequest(btn.dataset.strategyArchive, btn.dataset.strategyBilling === 'true'));
    });
    board.querySelectorAll('[data-strategy-restore]').forEach(btn => {
      btn.addEventListener('click', () => restoreStrategyRequest(btn.dataset.strategyRestore));
    });
    board.querySelectorAll('[data-strategy-delete]').forEach(btn => {
      btn.addEventListener('click', () => deleteStrategyRequest(btn.dataset.strategyDelete));
    });
    board.querySelectorAll('[data-strategy-bank]').forEach(btn => {
      btn.addEventListener('click', () => {
        const bankId = btn.dataset.strategyBank;
        if (!bankId) return;
        goTo('banks');
        loadBank(bankId, { collapseResults: true });
      });
    });
  }

  function renderStrategyCard(row) {
    if (row.isArchived) return renderArchivedStrategyCard(row);
    const availableMoves = row.isArchived ? [] : STRATEGY_STATUSES.filter(status => status !== row.status);
    return `
      <article class="strategy-card">
        <div class="strategy-card-head">
          <strong>${escapeHtml(row.requestType || 'Miscellaneous')}</strong>
          <span>
            ${row.isArchived ? '<em class="strategy-archive-badge">Archived</em>' : ''}
            <em class="bank-pill ${coverageClass(row.status)}">${escapeHtml(row.status || 'Open')}</em>
          </span>
        </div>
        <button type="button" class="strategy-bank-link" data-strategy-bank="${escapeHtml(row.bankId || '')}">
          ${escapeHtml(row.displayName || 'Bank')}
        </button>
        <p>${escapeHtml(row.summary || 'Strategy request')}</p>
        ${row.comments ? `<div class="strategy-card-comments">${escapeHtml(row.comments).replace(/\n/g, '<br>')}</div>` : ''}
        ${renderStrategyFiles(row)}
        <div class="strategy-card-meta">
          <span>Priority ${escapeHtml(row.priority || '3')}/5</span>
          ${row.requestedBy ? `<span>By ${escapeHtml(row.requestedBy)}</span>` : ''}
          ${row.assignedTo ? `<span>Owner ${escapeHtml(row.assignedTo)}</span>` : ''}
          ${row.invoiceContact ? `<span>Invoice ${escapeHtml(row.invoiceContact)}</span>` : ''}
          <span>${escapeHtml([row.city, row.state].filter(Boolean).join(', '))}</span>
          <span>Updated ${escapeHtml(formatFullTimestamp(row.updatedAt))}</span>
          ${row.billedAt ? `<span>Billed ${escapeHtml(formatFullTimestamp(row.billedAt))}</span>` : ''}
          ${row.archivedAt ? `<span>Archived ${escapeHtml(formatFullTimestamp(row.archivedAt))}</span>` : ''}
        </div>
        <div class="strategy-card-actions">
          ${row.isArchived ? `
            <button type="button" class="text-btn" data-strategy-restore="${escapeHtml(row.id)}">Restore</button>
          ` : ''}
          <button type="button" class="text-btn" data-strategy-edit="${escapeHtml(row.id)}">Details</button>
          ${availableMoves.map(status => `
            <button type="button" class="text-btn" data-strategy-update="${escapeHtml(row.id)}" data-strategy-status="${escapeHtml(status)}">
              Move to ${escapeHtml(status)}
            </button>
          `).join('')}
          ${!row.isArchived && row.status === 'Completed' ? `
            <button type="button" class="text-btn" data-strategy-archive="${escapeHtml(row.id)}">Archive</button>
          ` : ''}
          ${!row.isArchived && row.status === 'Needs Billed' ? `
            <button type="button" class="text-btn" data-strategy-archive="${escapeHtml(row.id)}" data-strategy-billing="true">Mark Billed + Archive</button>
          ` : ''}
          <button type="button" class="text-btn strategy-danger-btn" data-strategy-delete="${escapeHtml(row.id)}">Delete</button>
        </div>
        ${renderStrategyEditor(row)}
      </article>
    `;
  }

  function renderArchivedStrategyCard(row) {
    const notes = row.comments || 'No notes added.';
    return `
      <article class="strategy-card strategy-card-archived">
        <button type="button" class="strategy-archive-summary" data-strategy-edit="${escapeHtml(row.id)}">
          <span class="strategy-archive-summary-head">
            <strong>${escapeHtml(row.displayName || 'Bank')}</strong>
            <span>
              <em class="strategy-archive-badge">Archived</em>
              <em class="bank-pill ${coverageClass(row.status)}">${escapeHtml(row.status || 'Open')}</em>
            </span>
          </span>
          <span class="strategy-archive-task">${escapeHtml(row.requestType || 'Miscellaneous')}: ${escapeHtml(row.summary || 'Strategy request')}</span>
          <span class="strategy-archive-notes">${escapeHtml(notes)}</span>
          <span class="strategy-archive-meta">
            <span>${escapeHtml(strategyCompletionLabel(row))}</span>
            ${row.archivedAt ? `<span>Archived ${escapeHtml(formatFullTimestamp(row.archivedAt))}</span>` : '<span>Archived</span>'}
            <span class="strategy-archive-toggle">View details</span>
          </span>
        </button>
        ${renderStrategyEditor(row, { archivedDetails: true })}
      </article>
    `;
  }

  function strategyCompletionLabel(row) {
    if (row.billedAt) return `Billed ${formatFullTimestamp(row.billedAt)}`;
    if (row.completedAt) return `Completed ${formatFullTimestamp(row.completedAt)}`;
    return `Status ${row.status || 'Open'}`;
  }

  function renderStrategyEditor(row, options = {}) {
    return `
      <div class="strategy-edit-panel${options.archivedDetails ? ' strategy-archive-detail-panel' : ''}" id="strategyEdit-${escapeHtml(row.id)}" hidden>
        ${options.archivedDetails ? `
          <div class="strategy-archive-full-details">
            <button type="button" class="strategy-bank-link" data-strategy-bank="${escapeHtml(row.bankId || '')}">
              ${escapeHtml(row.displayName || 'Bank')}
            </button>
            <div class="strategy-card-meta">
              <span>${escapeHtml(row.requestType || 'Miscellaneous')}</span>
              <span>${escapeHtml(row.status || 'Open')}</span>
              <span>Priority ${escapeHtml(row.priority || '3')}/5</span>
              ${row.requestedBy ? `<span>By ${escapeHtml(row.requestedBy)}</span>` : ''}
              ${row.assignedTo ? `<span>Owner ${escapeHtml(row.assignedTo)}</span>` : ''}
              ${row.invoiceContact ? `<span>Invoice ${escapeHtml(row.invoiceContact)}</span>` : ''}
              <span>${escapeHtml([row.city, row.state].filter(Boolean).join(', '))}</span>
              <span>Updated ${escapeHtml(formatFullTimestamp(row.updatedAt))}</span>
              ${row.billedAt ? `<span>Billed ${escapeHtml(formatFullTimestamp(row.billedAt))}</span>` : ''}
              ${row.archivedAt ? `<span>Archived ${escapeHtml(formatFullTimestamp(row.archivedAt))}</span>` : ''}
            </div>
            ${renderStrategyFiles(row)}
            <div class="strategy-card-actions">
              <button type="button" class="text-btn" data-strategy-cancel="${escapeHtml(row.id)}">Minimize</button>
              <button type="button" class="text-btn" data-strategy-restore="${escapeHtml(row.id)}">Restore</button>
              <button type="button" class="text-btn strategy-danger-btn" data-strategy-delete="${escapeHtml(row.id)}">Delete</button>
            </div>
          </div>
        ` : ''}
        <div class="strategy-edit-grid">
          <label>
            <span>Request Type</span>
            <select data-strategy-field="requestType">${coverageSelectOptions(STRATEGY_TYPES, row.requestType || 'Miscellaneous')}</select>
          </label>
          <label>
            <span>Status</span>
            <select data-strategy-field="status">${coverageSelectOptions(STRATEGY_STATUSES, row.status || 'Open')}</select>
          </label>
          <label>
            <span>Priority</span>
            <select data-strategy-field="priority">${coverageSelectOptions(STRATEGY_PRIORITIES, row.priority || '3')}</select>
          </label>
          <label>
            <span>Requested By</span>
            <input type="text" data-strategy-field="requestedBy" value="${escapeHtml(row.requestedBy || '')}">
          </label>
          <label>
            <span>Assigned To</span>
            <input type="text" data-strategy-field="assignedTo" value="${escapeHtml(row.assignedTo || '')}">
          </label>
          <label>
            <span>Invoice Contact</span>
            <input type="text" data-strategy-field="invoiceContact" value="${escapeHtml(row.invoiceContact || '')}">
          </label>
          <label class="wide">
            <span>Summary</span>
            <input type="text" data-strategy-field="summary" value="${escapeHtml(row.summary || '')}">
          </label>
          <label class="wide">
            <span>Comments</span>
            <textarea rows="4" data-strategy-field="comments">${escapeHtml(row.comments || '')}</textarea>
          </label>
          <div class="wide strategy-file-upload" data-strategy-drop>
            <div>
              <span>Final Deliverable</span>
              <strong data-strategy-file-name>No file selected</strong>
              <small>Drop the final swap, BCIS, THO, CECL, PDF, workbook, Word doc, or CSV here.</small>
            </div>
            <input type="file" data-strategy-file accept=".pdf,.xlsx,.xlsm,.xlsb,.xls,.docx,.csv">
          </div>
        </div>
        <div class="strategy-edit-actions">
          <button type="button" class="small-btn" data-strategy-save="${escapeHtml(row.id)}">Save Details</button>
          <button type="button" class="text-btn" data-strategy-upload="${escapeHtml(row.id)}">Upload File</button>
          <button type="button" class="text-btn" data-strategy-cancel="${escapeHtml(row.id)}">Cancel</button>
        </div>
      </div>
    `;
  }

  function renderStrategyFiles(row) {
    const files = Array.isArray(row.files) ? row.files : [];
    if (!files.length) return '';
    return `
      <div class="strategy-files">
        <span>Files</span>
        ${files.map(file => `
          <a href="/api/strategies/${encodeURIComponent(row.id)}/files/${encodeURIComponent(file.id)}" target="_blank" rel="noopener">
            ${escapeHtml(file.filename || 'Strategy file')}
          </a>
        `).join('')}
      </div>
    `;
  }

  function updateStrategyDropFileName(drop, file) {
    const label = drop ? drop.querySelector('[data-strategy-file-name]') : null;
    if (label) label.textContent = file && file.name ? file.name : 'No file selected';
    if (drop) drop.classList.toggle('has-file', Boolean(file));
  }

  function wireStrategyDropZones(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-strategy-drop]').forEach(drop => {
      const input = drop.querySelector('[data-strategy-file]');
      const fileName = drop.querySelector('[data-strategy-file-name]');
      if (input) {
        input.addEventListener('change', () => updateStrategyDropFileName(drop, input.files && input.files[0]));
      }
      drop.addEventListener('click', event => {
        if (event.target && event.target.closest('button, input')) return;
        if (input) input.click();
      });
      ['dragenter', 'dragover'].forEach(type => {
        drop.addEventListener(type, event => {
          event.preventDefault();
          drop.classList.add('dragging');
        });
      });
      ['dragleave', 'drop'].forEach(type => {
        drop.addEventListener(type, event => {
          event.preventDefault();
          drop.classList.remove('dragging');
        });
      });
      drop.addEventListener('drop', event => {
        const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
        if (!file || !input) return;
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        updateStrategyDropFileName(drop, file);
        if (fileName) fileName.focus?.();
      });
    });
  }

  function showStrategyEditor(id) {
    const panel = document.getElementById(`strategyEdit-${id}`);
    if (panel) panel.hidden = false;
  }

  function hideStrategyEditor(id) {
    const panel = document.getElementById(`strategyEdit-${id}`);
    if (panel) panel.hidden = true;
  }

  function strategyEditorValues(id) {
    const panel = document.getElementById(`strategyEdit-${id}`);
    const payload = {};
    if (!panel) return payload;
    panel.querySelectorAll('[data-strategy-field]').forEach(field => {
      payload[field.dataset.strategyField] = field.value;
    });
    return payload;
  }

  async function saveStrategyEditor(id) {
    if (!id) return;
    try {
      const res = await fetch(`/api/strategies/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(strategyEditorValues(id))
      });
      const data = await readBankJson(res);
      strategyRequests = strategyRequests.map(row => row.id === data.request.id ? data.request : row);
      refreshStrategyCountsFromRows();
      renderStrategyBoard();
      await loadStrategyNotifications();
      refreshVisibleStrategyHistoryForRequest(data.request);
      showToast('Saved strategy request details');
    } catch (e) {
      showToast(e.message, true);
    }
  }

  async function uploadStrategyFile(id) {
    if (!id) return;
    const panel = document.getElementById(`strategyEdit-${id}`);
    const input = panel ? panel.querySelector('[data-strategy-file]') : null;
    return uploadStrategyFileFromInput(id, input);
  }

  async function uploadStrategyFileFromInput(id, input, options = {}) {
    if (!id) return null;
    const file = input && input.files ? input.files[0] : null;
    if (!file) return showToast('Choose a file to upload', true);
    const body = new FormData();
    body.append('strategyFile', file);
    try {
      const res = await fetch(`/api/strategies/${encodeURIComponent(id)}/files`, {
        method: 'POST',
        body
      });
      const data = await readBankJson(res);
      if (data.request) {
        const existing = strategyRequests.some(row => row.id === data.request.id);
        strategyRequests = existing
          ? strategyRequests.map(row => row.id === data.request.id ? data.request : row)
          : [data.request, ...strategyRequests];
        renderStrategyBoard();
        await loadStrategyNotifications();
        refreshVisibleStrategyHistoryForRequest(data.request);
      }
      if (input) {
        input.value = '';
        const drop = input.closest('[data-strategy-drop]');
        updateStrategyDropFileName(drop, null);
      }
      if (!options.silent) showToast('Uploaded strategy file');
      return data.request || null;
    } catch (e) {
      showToast(e.message, true);
      return null;
    }
  }

  function refreshStrategyCountsFromRows() {
    STRATEGY_STATUSES.forEach(nextStatus => {
      strategyCounts[nextStatus] = strategyRequests.filter(row => row.status === nextStatus).length;
    });
  }

  async function updateStrategyStatus(id, status) {
    if (!id || !status) return;
    try {
      const res = await fetch(`/api/strategies/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      const data = await readBankJson(res);
      strategyRequests = strategyRequests.map(row => row.id === data.request.id ? data.request : row);
      refreshStrategyCountsFromRows();
      renderStrategyBoard();
      await loadStrategyNotifications();
      refreshVisibleStrategyHistoryForRequest(data.request);
      showToast(`Moved request to ${status}`);
    } catch (e) {
      showToast(e.message, true);
    }
  }

  async function archiveStrategyRequest(id, markBilled) {
    if (!id) return;
    try {
      const res = await fetch(`/api/strategies/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true, markBilled: Boolean(markBilled) })
      });
      await readBankJson(res);
      await loadStrategies();
      await loadStrategyNotifications();
      if (currentVisibleStrategyHistoryBankId()) loadBankStrategyHistory(currentVisibleStrategyHistoryBankId());
      showToast(markBilled ? 'Marked billed and archived request' : 'Archived strategy request');
    } catch (e) {
      showToast(e.message, true);
    }
  }

  async function restoreStrategyRequest(id) {
    if (!id) return;
    try {
      const res = await fetch(`/api/strategies/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: false })
      });
      await readBankJson(res);
      await loadStrategies();
      await loadStrategyNotifications();
      if (currentVisibleStrategyHistoryBankId()) loadBankStrategyHistory(currentVisibleStrategyHistoryBankId());
      showToast('Restored strategy request');
    } catch (e) {
      showToast(e.message, true);
    }
  }

  async function deleteStrategyRequest(id) {
    if (!id) return;
    const row = strategyRequests.find(item => item.id === id);
    const label = row ? `${row.requestType || 'Strategy request'} for ${row.displayName || 'this bank'}` : 'this strategy request';
    if (!window.confirm(`Delete ${label}? This permanently removes the request and any attached files.`)) return;
    try {
      const res = await fetch(`/api/strategies/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', confirm: true })
      });
      await readBankJson(res);
      strategyRequests = strategyRequests.filter(item => item.id !== id);
      refreshStrategyCountsFromRows();
      renderStrategyBoard();
      await loadStrategies();
      await loadStrategyNotifications();
      if (currentVisibleStrategyHistoryBankId()) loadBankStrategyHistory(currentVisibleStrategyHistoryBankId());
      showToast('Deleted strategy request');
    } catch (e) {
      showToast(e.message, true);
    }
  }

  function setupBankWorkspaceTabs() {
    document.querySelectorAll('[data-bank-view]').forEach(btn => {
      btn.addEventListener('click', () => switchBankWorkspace(btn.dataset.bankView));
    });
  }

  function switchBankWorkspace(view) {
    const next = view === 'coverage' ? 'coverage' : 'tear-sheet';
    activeBankWorkspaceView = next;
    document.querySelectorAll('[data-bank-view]').forEach(btn => {
      const active = btn.dataset.bankView === next;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-bank-view-panel]').forEach(panel => {
      const active = panel.dataset.bankViewPanel === next;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });
    if (next === 'coverage') {
      if (!activeCoverageBankId && selectedTearSheetCoverage && selectedTearSheetCoverage.bankId) {
        activeCoverageBankId = selectedTearSheetCoverage.bankId;
        selectedBankCoverage = selectedTearSheetCoverage;
      }
      loadSavedBanks();
      if (activeCoverageBankId) loadBankCoverage(activeCoverageBankId, { renderDetail: true });
      else renderCoverageDetailEmpty();
    }
  }

  async function readBankJson(res) {
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error('The portal server is serving the old page instead of bank data. Restart the portal, then refresh this screen.');
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Bank data request failed');
    return data;
  }

  async function searchBanks(query) {
    const results = document.getElementById('bankSearchResults');
    const q = String(query || '').trim();
    if (!results) return;
    if (q.length < 2) {
      results.innerHTML = '<div class="bank-search-empty">Type at least two characters to search banks.</div>';
      return;
    }
    results.innerHTML = '<div class="bank-search-empty">Searching banks&hellip;</div>';
    try {
      const res = await fetch(`/api/banks/search?q=${encodeURIComponent(q)}&limit=10`, { cache: 'no-store' });
      const data = await readBankJson(res);
      renderBankResults(data.results || []);
    } catch (e) {
      results.innerHTML = `<div class="bank-search-empty">${escapeHtml(e.message)}</div>`;
    }
  }

  function renderBankResults(rows) {
    const results = document.getElementById('bankSearchResults');
    if (!results) return;
    if (!rows.length) {
      results.innerHTML = '<div class="bank-search-empty">No matching banks found.</div>';
      return;
    }
    results.innerHTML = rows.map(row => {
      const status = statusForBankRow(row);
      const coverage = [
        status.owner ? `Owner: ${status.owner}` : '',
        status.affiliate ? `Affiliate: ${status.affiliate}` : '',
        status.services ? `${serviceCount(status.services)} FBBS services` : '',
        status.bankersBankServices ? `${serviceCount(status.bankersBankServices)} Bankers Bank services` : ''
      ].filter(Boolean).join(' · ');
      return `
      <button type="button" class="bank-result" data-bank-id="${escapeHtml(row.id)}">
        <div>
          <strong>${escapeHtml(bankDisplayName(row))}</strong>
          ${coverage ? `<small>${escapeHtml(coverage)}</small>` : ''}
        </div>
        <span>${escapeHtml([row.city, row.state, row.certNumber ? `Cert ${row.certNumber}` : '', row.primaryRegulator].filter(Boolean).join(' · '))}</span>
        <div class="bank-result-meta">
          <em>${escapeHtml(row.period || '')}</em>
          ${renderBankStatusChip(row)}
        </div>
      </button>
      `;
    }).join('');
    results.querySelectorAll('[data-bank-id]').forEach(btn => {
      btn.addEventListener('click', () => loadBank(btn.dataset.bankId, { collapseResults: true }));
    });
  }

  function clearBankSearchResults() {
    const results = document.getElementById('bankSearchResults');
    if (results) results.innerHTML = '';
  }

  function bankAccountStatusLabel(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') return value.status || value.accountStatusLabel || '';
    return String(value);
  }

  function bankDisplayName(row) {
    if (!row) return 'Bank';
    const displayName = String(row.displayName || row.name || row.legalName || 'Bank').trim();
    const city = String(row.city || '').trim();
    const state = String(row.state || '').trim();
    if (displayName && city && state) {
      const suffix = `, ${city}, ${state}`;
      if (displayName.toLowerCase().endsWith(suffix.toLowerCase())) {
        return displayName.slice(0, -suffix.length).trim() || displayName;
      }
    }
    return displayName || 'Bank';
  }

  function loadRecentBanks() {
    try {
      const parsed = JSON.parse(localStorage.getItem(BANK_RECENT_STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter(row => row && row.id).slice(0, MAX_RECENT_BANKS) : [];
    } catch (e) {
      return [];
    }
  }

  function saveRecentBanks(rows) {
    try {
      localStorage.setItem(BANK_RECENT_STORAGE_KEY, JSON.stringify(rows.slice(0, MAX_RECENT_BANKS)));
    } catch (e) {
      // Recent banks are a convenience only.
    }
  }

  function rememberRecentBank(bank) {
    if (!bank || !bank.summary || !bank.id) return;
    const s = bank.summary;
    const row = {
      id: String(bank.id),
      displayName: s.displayName || s.name || 'Bank',
      city: s.city || '',
      state: s.state || '',
      certNumber: s.certNumber || '',
      primaryRegulator: s.primaryRegulator || '',
      period: s.period || '',
      accountStatus: bankAccountStatusLabel(s.accountStatus || currentBankAccountStatus())
    };
    const next = [row, ...loadRecentBanks().filter(existing => String(existing.id) !== row.id)];
    saveRecentBanks(next);
    renderRecentBanks();
  }

  function clearRecentBanks() {
    saveRecentBanks([]);
    renderRecentBanks();
    hideBankRecentDropdown();
  }

  function showBankRecentDropdown() {
    const panel = document.getElementById('bankRecentPanel');
    const list = document.getElementById('bankRecentList');
    const rows = loadRecentBanks();
    if (!panel || !list || !rows.length) return;
    renderRecentBanks();
    panel.hidden = false;
  }

  function hideBankRecentDropdown() {
    const panel = document.getElementById('bankRecentPanel');
    if (panel) panel.hidden = true;
  }

  function renderRecentBanks() {
    const panel = document.getElementById('bankRecentPanel');
    const list = document.getElementById('bankRecentList');
    if (!panel || !list) return;
    const rows = loadRecentBanks();
    panel.hidden = true;
    if (!rows.length) {
      list.innerHTML = '<option value="">No previous searches</option>';
      return;
    }
    list.innerHTML = [
      '<option value="">Select a recent bank</option>',
      ...rows.map(row => {
        const detail = [row.city, row.state, row.certNumber ? `Cert ${row.certNumber}` : ''].filter(Boolean).join(' · ');
        return `<option value="${escapeHtml(row.id)}">${escapeHtml(bankDisplayName(row))}${detail ? ` - ${escapeHtml(detail)}` : ''}</option>`;
      })
    ].join('');
    list.value = '';
    list.onchange = () => {
      if (!list.value) return;
      loadBank(list.value, { collapseResults: true });
      list.value = '';
      hideBankRecentDropdown();
    };
  }

  function getSavedBankById(bankId) {
    return savedBanks.find(row => String(row.bankId) === String(bankId)) || null;
  }

  async function loadSavedBanks() {
    try {
      const res = await fetch('/api/bank-coverage', { cache: 'no-store' });
      const data = await readBankJson(res);
      savedBanks = Array.isArray(data.savedBanks) ? data.savedBanks : [];
    } catch (e) {
      savedBanks = [];
      const list = document.getElementById('bankSavedList');
      if (list) list.innerHTML = `<div class="bank-search-empty">${escapeHtml(e.message)}</div>`;
    }
    renderSavedBanks();
  }

  function renderSavedBanks() {
    const list = document.getElementById('bankSavedList');
    const count = document.getElementById('bankSavedCount');
    const filter = document.getElementById('bankSavedFilterInput');
    if (!list) return;
    if (count) count.textContent = `${formatNumber(savedBanks.length)} saved`;
    if (!savedBanks.length) {
      list.innerHTML = '<div class="bank-search-empty">Save a bank from a tear sheet to start a coverage list.</div>';
      return;
    }
    const q = String(filter ? filter.value : '').trim().toLowerCase();
    const rows = q
      ? savedBanks.filter(row => [
          row.displayName, row.legalName, row.city, row.state, row.certNumber,
          row.primaryRegulator, row.status, row.priority, row.owner, row.nextActionDate
        ].filter(Boolean).join(' ').toLowerCase().includes(q))
      : savedBanks;
    if (!rows.length) {
      list.innerHTML = '<div class="bank-search-empty">No saved banks match that filter.</div>';
      return;
    }
    list.innerHTML = rows.map(row => `
      <button type="button" class="bank-saved-item${String(row.bankId) === String(activeCoverageBankId) ? ' active' : ''}" data-bank-id="${escapeHtml(row.bankId)}">
        <strong>${escapeHtml(bankDisplayName(row))}</strong>
        <span>${escapeHtml([row.city, row.state, row.certNumber ? `Cert ${row.certNumber}` : '', row.primaryRegulator].filter(Boolean).join(' · '))}</span>
        <div class="bank-saved-meta">
          <em class="bank-pill ${coverageClass(row.status)}">${escapeHtml(row.status || 'Open')}</em>
          <em class="bank-pill ${coverageClass(row.priority)}">${escapeHtml(row.priority || 'Medium')}</em>
          <small>${escapeHtml(row.nextActionDate ? formatShortDate(row.nextActionDate) : 'No date')}</small>
        </div>
      </button>
    `).join('');
    list.querySelectorAll('[data-bank-id]').forEach(btn => {
      btn.addEventListener('click', () => openSavedBankCoverage(btn.dataset.bankId));
    });
  }

  async function loadAccountCoverageAccounts() {
    const list = document.getElementById('bankAccountCoverageList');
    const count = document.getElementById('bankAccountCoverageCount');
    if (!list) return;
    const requestId = ++accountCoverageRequestId;
    const q = document.getElementById('bankAccountCoverageFilterInput')?.value || '';
    const status = document.getElementById('bankAccountCoverageStatusFilter')?.value || '';
    const service = document.getElementById('bankAccountCoverageServiceFilter')?.value || '';
    const sort = document.getElementById('bankAccountCoverageSort')?.value || 'owner';
    const params = new URLSearchParams({ limit: '300', sort });
    if (q.trim()) params.set('q', q.trim());
    if (status) params.set('status', status);
    if (service) params.set('service', service);
    list.innerHTML = '<div class="bank-search-empty">Loading account coverage matches...</div>';
    try {
      const res = await fetch(`/api/bank-account-statuses?${params.toString()}`, { cache: 'no-store' });
      const data = await readBankJson(res);
      if (requestId !== accountCoverageRequestId) return;
      accountCoverageAccounts = Array.isArray(data.accountStatuses) ? data.accountStatuses : [];
      if (count) {
        const total = data.importStatus && data.importStatus.statusCount ? data.importStatus.statusCount : accountCoverageAccounts.length;
        const resultCount = Number.isFinite(Number(data.resultCount)) ? Number(data.resultCount) : accountCoverageAccounts.length;
        count.textContent = `${formatNumber(accountCoverageAccounts.length)} shown · ${formatNumber(resultCount)} matches${resultCount !== total ? ` · ${formatNumber(total)} total` : ''}`;
      }
      renderAccountCoverageAccounts();
    } catch (e) {
      if (requestId !== accountCoverageRequestId) return;
      accountCoverageAccounts = [];
      if (count) count.textContent = '0 matched';
      list.innerHTML = `<div class="bank-search-empty">${escapeHtml(e.message)}</div>`;
    }
  }

  function renderAccountCoverageAccounts() {
    const list = document.getElementById('bankAccountCoverageList');
    if (!list) return;
    if (!accountCoverageAccounts.length) {
      list.innerHTML = '<div class="bank-search-empty">No account coverage matches fit the current filters.</div>';
      return;
    }
    list.innerHTML = accountCoverageAccounts.map(row => {
      const fbbsCount = serviceCount(row.services);
      const bankersCount = serviceCount(row.bankersBankServices);
      const serviceText = [
        fbbsCount ? `${fbbsCount} FBBS` : '',
        bankersCount ? `${bankersCount} Bankers Bank` : '',
        row.affiliate ? `${row.affiliate}${row.affiliateStatus ? ` ${row.affiliateStatus}` : ''}` : ''
      ].filter(Boolean).join(' · ');
      return `
        <button type="button" class="bank-account-coverage-item" data-bank-id="${escapeHtml(row.bankId)}">
          <strong>${escapeHtml(bankDisplayName(row))}</strong>
          <span>${escapeHtml([row.city, row.state, row.certNumber ? `Cert ${row.certNumber}` : ''].filter(Boolean).join(' · '))}</span>
          <span>${escapeHtml(row.owner ? `Owner: ${row.owner}` : 'Owner not assigned')}</span>
          <div class="bank-saved-meta">
            <em class="bank-pill ${coverageClass(row.status)}">${escapeHtml(row.status || 'Open')}</em>
            ${row.affiliate ? `<em class="bank-pill">${escapeHtml(row.affiliate)}</em>` : ''}
            ${serviceText ? `<small>${escapeHtml(serviceText)}</small>` : '<small>No services marked</small>'}
          </div>
        </button>
      `;
    }).join('');
    list.querySelectorAll('[data-bank-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        switchBankWorkspace('tear-sheet');
        loadBank(btn.dataset.bankId, { collapseResults: true });
      });
    });
  }

  function renderCoverageDetailEmpty() {
    const detail = document.getElementById('bankCoverageDetail');
    if (!detail) return;
    detail.innerHTML = `
      <div class="bank-empty-state">
        <div class="ff-kicker">Coverage Details</div>
        <h2>Select a saved bank</h2>
        <p>Coverage status, next actions, and notes will live here.</p>
      </div>
    `;
  }

  function renderCoverageDetailLoading(row) {
    const detail = document.getElementById('bankCoverageDetail');
    if (!detail) return;
    detail.innerHTML = `
      <div class="bank-empty-state">
        <div class="ff-kicker">Coverage Details</div>
        <h2>${escapeHtml(row && row.displayName ? row.displayName : 'Loading coverage...')}</h2>
        <p>Loading notes and saved coverage details.</p>
      </div>
    `;
  }

  async function openSavedBankCoverage(bankId) {
    activeCoverageBankId = String(bankId || '');
    selectedBankCoverage = getSavedBankById(activeCoverageBankId);
    selectedBankNotes = [];
    switchBankWorkspace('coverage');
    renderCoverageDetailLoading(selectedBankCoverage);
    await loadBankCoverage(activeCoverageBankId, { renderDetail: true });
  }

  function coverageClass(value) {
    return `bank-pill-${String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  }

  function defaultBankAccountStatus() {
    return { status: 'Open', source: 'default', isStored: false };
  }

  function currentBankAccountStatus() {
    const saved = selectedTearSheetCoverage && selectedTearSheetCoverage.status ? selectedTearSheetCoverage : null;
    const importedStatus = selectedBankAccountStatus || (selectedBank && selectedBank.bank && selectedBank.bank.summary && selectedBank.bank.summary.accountStatus) || null;
    const status = saved ? { ...(importedStatus || {}), ...saved } : (importedStatus || defaultBankAccountStatus());
    return {
      ...defaultBankAccountStatus(),
      ...status,
      status: status.status || 'Open'
    };
  }

  function statusForBankRow(row) {
    if (!row) return defaultBankAccountStatus();
    const saved = getSavedBankById(row.id || row.bankId);
    const importedStatus = row.accountStatus || null;
    const status = saved ? { ...(importedStatus || {}), ...saved } : (importedStatus || defaultBankAccountStatus());
    return {
      ...defaultBankAccountStatus(),
      ...status,
      status: status.status || 'Open'
    };
  }

  function renderBankStatusChip(row) {
    const status = statusForBankRow(row);
    return `<em class="bank-pill ${coverageClass(status.status)}">${escapeHtml(status.status || 'Open')}</em>`;
  }

  function serviceSet(value) {
    return new Set(String(value || '')
      .split(',')
      .map(part => part.trim())
      .filter(Boolean));
  }

  function serviceCount(value) {
    return serviceSet(value).size;
  }

  function serviceCheck(value) {
    return value ? '<span class="bank-service-check">&#10003;</span>' : '<span class="bank-service-empty"></span>';
  }

  function renderServiceGrid(title, countLabel, services, value) {
    const selected = serviceSet(value);
    return `
      <section class="bank-section bank-service-section">
        <div class="bank-section-title">${escapeHtml(title)}</div>
        <div class="bank-service-count">
          <span>${escapeHtml(countLabel)}</span>
          <strong>${formatNumber(selected.size)}</strong>
        </div>
        <div class="bank-service-grid">
          ${services.map(name => `
            <div class="bank-service-row">
              <span>${escapeHtml(name)}</span>
              ${serviceCheck(selected.has(name))}
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  function renderAccountDetailsSummary(values, status) {
    const address = [values.address, [values.city, values.state, values.zip].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
    const cells = [
      ['Account Team Members', status.owner],
      ['Phone', values.phone],
      ['Address 1', address],
      ['Affiliate', status.affiliate],
      ['Affiliate Status', status.affiliateStatus],
      ['Affiliate Rep', status.affiliateRep]
    ];
    return `
      <section class="bank-account-coverage-summary" id="bankAccountDetailsSummary">
        <div class="bank-account-coverage-title">
          <div>
            <span>Account Details</span>
            <strong>${escapeHtml(values.name || values.displayName || 'Bank')}</strong>
          </div>
          <em class="bank-pill ${coverageClass(status.status)}">${escapeHtml(status.status || 'Open')}</em>
        </div>
        <div class="bank-account-coverage-summary-grid">
          ${cells.map(([label, value]) => `
            <div>
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(value || '—')}</strong>
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  function renderTearSheetCoverageSignal() {
    const selectedStatus = document.getElementById('bankTearSheetStatus')?.value;
    const ownerInput = document.getElementById('bankTearSheetOwner');
    const status = {
      ...currentBankAccountStatus(),
      status: selectedStatus || currentBankAccountStatus().status || 'Open',
      owner: ownerInput ? ownerInput.value : currentBankAccountStatus().owner
    };
    return `
      <div class="bank-coverage-signal-inner">
        <em class="bank-pill ${coverageClass(status.status)}">${escapeHtml(status.status || 'Open')}</em>
        ${status.owner ? `<span>${escapeHtml(status.owner)}</span>` : ''}
      </div>
    `;
  }

  function updateTearSheetCoverageSignal() {
    const el = document.getElementById('bankProfileCoverageSignal');
    if (el) el.innerHTML = renderTearSheetCoverageSignal();
    refreshBankAccountDetailsSummary();
  }

  function refreshBankAccountDetailsSummary() {
    const summaryEl = document.getElementById('bankAccountDetailsSummary');
    if (!summaryEl || !selectedBank || !selectedBank.bank) return;
    const latest = selectedBank.bank.periods && selectedBank.bank.periods[0] ? selectedBank.bank.periods[0] : { values: {} };
    const statusSelect = document.getElementById('bankTearSheetStatus');
    const ownerInput = document.getElementById('bankTearSheetOwner');
    const status = {
      ...currentBankAccountStatus(),
      status: statusSelect ? statusSelect.value : currentBankAccountStatus().status || 'Open',
      owner: ownerInput ? ownerInput.value : currentBankAccountStatus().owner || ''
    };
    summaryEl.outerHTML = renderAccountDetailsSummary(latest.values || {}, status);
  }

  function coverageSelectOptions(values, selected) {
    return values.map(value => `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('');
  }

  function selectedBankId() {
    return selectedBank && selectedBank.bank ? selectedBank.bank.id : null;
  }

  function bankProfileSkeletonHtml() {
    const cells = Array.from({ length: 8 }, () => '<div class="skeleton-card"></div>').join('');
    return `
      <div class="bank-profile-skeleton" aria-busy="true" aria-label="Loading bank tear sheet">
        <div class="bps-head">
          <div class="skeleton-card bps-title"></div>
          <div class="skeleton-card bps-sub"></div>
        </div>
        <div class="bps-grid">${cells}</div>
        <div class="skeleton-card bps-block"></div>
        <div class="skeleton-card bps-block"></div>
      </div>`;
  }

  async function loadBank(id, options = {}) {
    // Guard against a slower earlier load resolving after a newer one and
    // rendering the wrong bank when the rep clicks through results quickly.
    const reqId = ++bankLoadRequestId;
    if (options.collapseResults) clearBankSearchResults();
    const profile = document.getElementById('bankProfile');
    if (profile) profile.innerHTML = bankProfileSkeletonHtml();
    try {
      const res = await fetch(`/api/banks/${encodeURIComponent(id)}`, { cache: 'no-store' });
      const loaded = await readBankJson(res);
      if (reqId !== bankLoadRequestId) return; // a newer bank load superseded this one
      selectedBank = loaded;
      selectedBankAccountStatus = (selectedBank.bank && selectedBank.bank.summary && selectedBank.bank.summary.accountStatus) || defaultBankAccountStatus();
      selectedTearSheetCoverage = getSavedBankById(selectedBank.bank.id);
      selectedBankNotes = [];
      selectedBankStrategyHistory = [];
      bankAssistantLastResponse = bankAssistantCache.get(selectedBank.bank.id) || null;
      renderBankProfile();
      if (bankAssistantLastResponse) renderAssistantResponse(bankAssistantLastResponse);
      if (options.openStrategyRequest) openBankStrategyRequestPanel();
      rememberRecentBank(selectedBank.bank);
      loadTearSheetCoverage(selectedBank.bank.id);
      loadBankStrategyHistory(selectedBank.bank.id);
    } catch (e) {
      if (reqId !== bankLoadRequestId) return; // a newer load is in flight; don't clobber it with this error
      if (profile) profile.innerHTML = `<div class="bank-empty-state"><h2>${escapeHtml(e.message)}</h2></div>`;
    }
  }

  function uploadBankWorkbook(file) {
    const status = document.getElementById('bankImportStatus');
    const input = document.getElementById('bankWorkbookInput');
    const formData = new FormData();
    formData.append('bankWorkbook', file, file.name);
    if (status) status.textContent = `Importing ${file.name}... this can take a minute.`;
    fetch('/api/banks/upload', { method: 'POST', body: formData })
      .then(async res => {
        const data = await readBankJson(res);
        showToast(`Imported ${formatNumber(data.metadata.bankCount)} banks · latest ${data.metadata.latestPeriod || '—'}`);
        return loadBankStatus();
      })
      .catch(err => {
        showToast(err.message, true);
        if (status) status.textContent = err.message;
      })
      .finally(() => {
        if (input) input.value = '';
      });
  }

  function uploadBankStatusWorkbook(file) {
    const status = document.getElementById('bankStatusImportStatus');
    const input = document.getElementById('bankStatusWorkbookInput');
    const formData = new FormData();
    formData.append('bankStatusWorkbook', file, file.name);
    if (status) status.textContent = `Importing statuses from ${file.name}...`;
    fetch('/api/bank-account-statuses/upload', { method: 'POST', body: formData })
      .then(async res => {
        const data = await readBankJson(res);
        const meta = data.metadata || {};
        showToast(`Imported ${formatNumber(meta.importedCount || 0)} bank statuses`);
        if (status) {
          const enrichedRows = [
            meta.ownerCount ? `${formatNumber(meta.ownerCount)} owners` : '',
            meta.servicesCount ? `${formatNumber(meta.servicesCount)} FBBS service rows` : '',
            meta.bankersBankServicesCount ? `${formatNumber(meta.bankersBankServicesCount)} Bankers Bank service rows` : ''
          ].filter(Boolean).join(' · ');
          status.textContent = `Imported ${formatNumber(meta.importedCount || 0)} statuses · ${formatNumber(meta.unmatchedCount || 0)} unmatched · ${meta.sheetName || 'workbook'}${enrichedRows ? ` · ${enrichedRows}` : ''}`;
        }
        return Promise.all([
          loadBankStatus(),
          loadSavedBanks(),
          loadAccountCoverageAccounts(),
          selectedBankId() ? loadBank(selectedBankId(), { collapseResults: false }) : Promise.resolve()
        ]);
      })
      .catch(err => {
        showToast(err.message, true);
        if (status) status.textContent = err.message;
      })
      .finally(() => {
        if (input) input.value = '';
      });
  }

  function uploadAveragedSeriesWorkbook(file, options = {}) {
    const status = document.getElementById(options.statusId || 'averagedSeriesImportStatus');
    const input = document.getElementById(options.inputId || 'averagedSeriesWorkbookInput');
    const formData = new FormData();
    formData.append('averagedSeriesWorkbook', file, file.name);
    if (status) status.textContent = `Importing peer averages from ${file.name}...`;
    fetch('/api/banks/averaged-series/upload', { method: 'POST', body: formData })
      .then(async res => {
        const data = await readBankJson(res);
        const meta = data.metadata || {};
        peerAnalysisState.peerData = null;
        showToast(`Stored peer averages · latest ${meta.latestPeriod || '—'} · ${formatNumber(meta.metricCount || 0)} metrics`);
        return loadBankStatus();
      })
      .catch(err => {
        showToast(err.message, true);
        if (status) status.textContent = err.message;
      })
      .finally(() => {
        if (input) input.value = '';
        if (options.labelId) setText(options.labelId, 'No workbook selected');
      });
  }

  function renderBankProfile() {
    const profile = document.getElementById('bankProfile');
    if (!profile || !selectedBank || !selectedBank.bank) return;
    const bank = selectedBank.bank;
    if (window.fbbsBreadcrumb) {
      window.fbbsBreadcrumb.setDetail('banks', (bank.summary && bank.summary.name) || bank.id);
    }
    const meta = selectedBank.metadata || {};
    const latest = bank.periods && bank.periods[0] ? bank.periods[0] : { values: {} };
    const values = latest.values || {};
    const recentPeriods = (bank.periods || []).slice(0, 8);
    const accountStatus = currentBankAccountStatus();
    const locationLine = [values.city, values.state].filter(Boolean).join(', ');
    const countyLabel = String(values.county || '').replace(/,.*$/, '').replace(/\s+county$/i, '').trim();
    const details = [
      ['Account Name', values.name || bank.summary.name],
      ['Phone', values.phone],
      ['Website', values.website],
      ['Location', locationLine],
      ['County', countyLabel],
      ['Fiduciary Assets ($000)', formatBankValue(values.fiduciaryAssets, 'money')],
      ['Cert Number', values.certNumber],
      ['Primary Regulator', values.primaryRegulator],
      ['FTEs', formatBankValue(values.fullTimeEmployees, 'number')],
      ['Subchapter S Election?', values.subchapterS],
      ['Number of Offices', formatBankValue(values.numberOfOffices, 'number')],
      ['Affiliate', accountStatus.affiliate],
      ['Affiliate Status', accountStatus.affiliateStatus],
      ['Affiliate Rep', accountStatus.affiliateRep]
    ];

    profile.innerHTML = `
      <div class="bank-profile-head">
        <div>
          <span class="tool-eyebrow">Call Report Tear Sheet</span>
          <h3>${escapeHtml(values.name || bank.summary.displayName || 'Bank')}</h3>
          <p>${escapeHtml([values.city, values.state, values.certNumber ? `Cert ${values.certNumber}` : '', values.primaryRegulator].filter(Boolean).join(' · '))}</p>
        </div>
        <div class="bank-profile-tools">
          <div class="bank-profile-actions">
            <select id="bankTearSheetStatus" class="bank-action-select" aria-label="Bank account status">${coverageSelectOptions(BANK_COVERAGE_STATUSES, currentBankAccountStatus().status || 'Open')}</select>
            <input type="text" id="bankTearSheetOwner" class="bank-action-input" value="${escapeHtml(currentBankAccountStatus().owner || '')}" placeholder="Account owner" aria-label="Account owner">
            <button type="button" class="small-btn bank-action-btn" id="bankStatusSaveBtn">Save Status / Owner</button>
            <button type="button" class="small-btn bank-action-btn" id="bankSaveBtn">Save Bank</button>
            <button type="button" class="small-btn bank-action-btn" id="bankStrategyToggleBtn">Strategy Request</button>
            <button type="button" class="small-btn bank-action-btn" id="bankPeerReportBtn">Peer Report</button>
            <button type="button" class="small-btn bank-action-btn" id="bankPortfolioReportBtn">Portfolio Review</button>
            <button type="button" class="small-btn bank-action-btn" id="bankPrintBtn">Print</button>
            <button type="button" class="small-btn bank-action-btn" id="bankExportBtn">Export CSV</button>
          </div>
          <div class="bank-period-badge">
            <strong>${escapeHtml(latest.endDate || latest.period || '—')}</strong>
            <span>${escapeHtml(meta.latestPeriod || latest.period || '')}</span>
          </div>
        </div>
      </div>
      ${renderAccountDetailsSummary(values, accountStatus)}
      ${renderBankStrategyRequestPanel()}
      ${renderBankSection('Details', details, true)}
      ${renderBankContactsPanel()}
      ${renderBankPeerBanner(bank.peerComparison)}
      ${renderBankCallReportSection('Balance Sheet', bankBalanceSheetRows(), recentPeriods, 1, bank.peerComparison)}
      ${renderBankCallReportSection('Securities (HTM & AFS-Fair Value)', bankSecuritiesRows(), recentPeriods, 13, bank.peerComparison)}
      ${renderBankCallReportSection('Loan Composition', bankLoanCompositionRows(), recentPeriods, 26, bank.peerComparison)}
      ${renderBankCallReportSection('Capital', bankCapitalRows(), recentPeriods, 31, bank.peerComparison)}
      ${renderBankCallReportSection('Profitability', bankProfitabilityRows(), recentPeriods, 38, bank.peerComparison)}
      ${renderBankCallReportSection('Asset Quality', bankAssetQualityRows(), recentPeriods, 57, bank.peerComparison)}
      ${renderBankCallReportSection('Liquidity', bankLiquidityRows(), recentPeriods, 63, bank.peerComparison)}
      ${renderBankProductFitPanel()}
      ${renderBankActivityPanel()}
      ${renderBankAssistantPanel()}
      ${renderBankIntelligencePanel(bank, values, recentPeriods)}
      <div class="bank-services-pair">
        ${renderServiceGrid('FBBS Services', 'FBBS Service Count', FBBS_SERVICE_NAMES, accountStatus.services)}
        ${renderServiceGrid("Bankers' Bank Services", "Bankers' Bank Service Count", BANKERS_BANK_SERVICE_NAMES, accountStatus.bankersBankServices)}
      </div>
      ${renderBankStrategyHistoryPanel()}
      ${renderBankUploadedFilesPanel(bank)}
    `;
    updateBankSaveButton();
    const saveBtn = document.getElementById('bankSaveBtn');
    const statusSaveBtn = document.getElementById('bankStatusSaveBtn');
    const strategyToggleBtn = document.getElementById('bankStrategyToggleBtn');
    const statusSelect = document.getElementById('bankTearSheetStatus');
    const ownerInput = document.getElementById('bankTearSheetOwner');
    const strategySubmitBtn = document.getElementById('bankStrategySubmitBtn');
    const strategyCancelBtn = document.getElementById('bankStrategyCancelBtn');
    const peerReportBtn = document.getElementById('bankPeerReportBtn');
    const portfolioReportBtn = document.getElementById('bankPortfolioReportBtn');
    const printBtn = document.getElementById('bankPrintBtn');
    const exportBtn = document.getElementById('bankExportBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveCurrentBankCoverage);
    if (statusSaveBtn) statusSaveBtn.addEventListener('click', saveCurrentBankAccountStatus);
    if (strategyToggleBtn) strategyToggleBtn.addEventListener('click', toggleBankStrategyRequestPanel);
    if (strategySubmitBtn) strategySubmitBtn.addEventListener('click', submitCurrentBankStrategyRequest);
    if (strategyCancelBtn) strategyCancelBtn.addEventListener('click', hideBankStrategyRequestPanel);
    if (peerReportBtn) peerReportBtn.addEventListener('click', () => openBankReportBuilder('bank-peer'));
    if (portfolioReportBtn) portfolioReportBtn.addEventListener('click', () => openBankReportBuilder('portfolio-peer'));
    if (statusSelect) statusSelect.addEventListener('change', updateTearSheetCoverageSignal);
    if (ownerInput) ownerInput.addEventListener('input', updateTearSheetCoverageSignal);
    if (printBtn) printBtn.addEventListener('click', printBankProfile);
    if (exportBtn) exportBtn.addEventListener('click', exportBankProfileCsv);
    wireBankContactsControls();
    wireBankProductFitControls();
    loadBankActivity(bank.id);
    loadBankIntelligence(bank.id);
    profile.querySelectorAll('[data-bank-assistant-action]').forEach(btn => {
      btn.addEventListener('click', () => runBankAssistant(btn.dataset.bankAssistantAction || 'fit'));
    });
    profile.querySelectorAll('[data-cohort-picker]').forEach(select => {
      select.addEventListener('change', () => handlePeerCohortChange(select));
    });
    profile.querySelectorAll('[data-save-peer-preference]').forEach(btn => {
      btn.addEventListener('click', savePeerCohortPreference);
    });
    wireStrategyDropZones(profile);
  }

  function intelligenceNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function intelligencePeer(bank, key) {
    return bank && bank.peerComparison && bank.peerComparison.byKey
      ? bank.peerComparison.byKey[key]
      : null;
  }

  function formatIntelligenceDelta(delta, type = 'percent') {
    const n = intelligenceNumber(delta);
    if (n === null) return '—';
    const prefix = n > 0 ? '+' : n < 0 ? '-' : '';
    const abs = Math.abs(n);
    return type === 'money'
      ? `${prefix}${formatMoney(abs, 0)}`
      : `${prefix}${abs.toFixed(2)} pts`;
  }

  function intelligenceMetricTile(label, value, detail, tone = '') {
    return `
      <div class="bank-intel-tile ${escapeHtml(tone)}">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value || '—')}</strong>
        <em>${escapeHtml(detail || '')}</em>
      </div>
    `;
  }

  function renderBankIntelligencePeerRows(bank, values) {
    const rows = [
      ['Securities / Assets', 'securitiesToAssets', 'percent'],
      ['Loans / Assets', 'loansToAssets', 'percent'],
      ['Loans / Deposits', 'loansToDeposits', 'percent'],
      ['Yield on Securities', 'yieldOnSecurities', 'percent'],
      ['NIM', 'netInterestMargin', 'percent'],
      ['Liquid Assets / Assets', 'liquidAssetsToAssets', 'percent']
    ].map(([label, key, type]) => {
      const peer = intelligencePeer(bank, key);
      const current = intelligenceNumber(values[key]);
      const peerValue = peer ? intelligenceNumber(peer.peerValue) : null;
      const rawDelta = peer ? intelligenceNumber(peer.delta) : null;
      const delta = rawDelta !== null
        ? rawDelta
        : (current !== null && peerValue !== null ? current - peerValue : null);
      return { label, key, type, current, peerValue, delta };
    }).filter(row => row.current !== null || row.peerValue !== null);
    if (!rows.length) {
      return '<div class="bank-search-empty">Peer averages are not available for this bank yet.</div>';
    }
    return `
      <div class="bank-intel-peer-table">
        ${rows.map(row => `
          <div>
            <span>${escapeHtml(row.label)}</span>
            <strong>${escapeHtml(formatBankValue(row.current, row.type))}</strong>
            <em>Peer ${escapeHtml(formatBankValue(row.peerValue, row.type))} · ${escapeHtml(formatIntelligenceDelta(row.delta, row.type))}</em>
          </div>
        `).join('')}
      </div>
    `;
  }

  function bankInsightNumber(values, keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    let total = 0;
    let found = false;
    list.forEach(key => {
      const value = intelligenceNumber(values && values[key]);
      if (value !== null) {
        total += value;
        found = true;
      }
    });
    return found ? total : null;
  }

  function bankInsightValue(values, row) {
    if (!values || !row) return null;
    if (row.shareOf) {
      const numerator = bankInsightNumber(values, row.keys || row.key);
      const denominator = bankInsightNumber(values, row.shareOf);
      return numerator !== null && denominator ? numerator / denominator * 100 : null;
    }
    return bankInsightNumber(values, row.keys || row.key);
  }

  function formatBankInsightValue(value, type) {
    if (value === null || value === undefined || value === '') return '-';
    if (type === 'money') return formatCallReportValue(value, 'money');
    if (type === 'percent') return formatCallReportValue(value, 'percent');
    return formatCallReportValue(value, type);
  }

  function renderBankSnapshotSection(section, periods) {
    const rows = (section.rows || []).map(row => {
      const values = periods.map(period => bankInsightValue(period.values || {}, row));
      const hasValue = values.some(value => value !== null && value !== undefined && value !== '');
      return hasValue ? { ...row, values } : null;
    }).filter(Boolean);
    if (!rows.length) return '';
    return `
      <div class="bank-snapshot-table-wrap">
        <h5>${escapeHtml(section.title)}</h5>
        <table class="bank-snapshot-table">
          <thead>
            <tr>
              <th>Metric</th>
              ${periods.map(period => `<th>${escapeHtml(period.period || period.endDate || '')}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                <td>${escapeHtml(row.label)}</td>
                ${row.values.map(value => `<td>${escapeHtml(formatBankInsightValue(value, row.type))}</td>`).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderBankPerformanceSnapshot(recentPeriods) {
    const periods = (recentPeriods || []).slice(0, 5).reverse();
    if (!periods.length) return '';
    const securitiesTotalKeys = ['afsTotal', 'htmTotal'];
    const sections = [
      {
        title: 'Investments',
        rows: [
          { label: 'Total Securities', keys: securitiesTotalKeys, type: 'money' },
          { label: 'Securities / Assets', key: 'securitiesToAssets', type: 'percent' },
          { label: 'US Agencies / Corps', keys: ['afsAgencyCorp', 'htmAgencyCorp'], shareOf: securitiesTotalKeys, type: 'percent' },
          { label: 'Municipals', keys: ['afsMunis', 'htmMunis'], shareOf: securitiesTotalKeys, type: 'percent' },
          { label: 'MBS / Structured', keys: ['afsAllMbs', 'htmAllMbs', 'afsOtherDebt', 'htmOtherDebt'], shareOf: securitiesTotalKeys, type: 'percent' },
          { label: 'Yield on Securities', key: 'yieldOnSecurities', type: 'percent' },
          { label: 'Securities FV / BV', key: 'securitiesFvToBv', type: 'percent' },
          { label: 'Pledged Securities / Securities', keys: ['pledgedSecurities'], shareOf: securitiesTotalKeys, type: 'percent' }
        ]
      },
      {
        title: 'Balance Sheet Mix',
        rows: [
          { label: 'Total Assets', key: 'totalAssets', type: 'money' },
          { label: 'Total Loans', key: 'totalLoans', type: 'money' },
          { label: 'Total Deposits', key: 'totalDeposits', type: 'money' },
          { label: 'Loans / Assets', key: 'loansToAssets', type: 'percent' },
          { label: 'Loans / Deposits', key: 'loansToDeposits', type: 'percent' },
          { label: 'Liquid Assets / Assets', key: 'liquidAssetsToAssets', type: 'percent' },
          { label: 'Brokered Deposits / Deposits', key: 'brokeredDepositsToDeposits', type: 'percent' },
          { label: 'Non-Interest Bearing Deposits', key: 'nonInterestBearingDeposits', type: 'percent' }
        ]
      },
      {
        title: 'Earnings & Credit',
        rows: [
          { label: 'Net Interest Margin', key: 'netInterestMargin', type: 'percent' },
          { label: 'Cost of Funds', key: 'costOfFunds', type: 'percent' },
          { label: 'Yield on Loans', key: 'yieldOnLoans', type: 'percent' },
          { label: 'ROA', key: 'roa', type: 'percent' },
          { label: 'ROE', key: 'roe', type: 'percent' },
          { label: 'Efficiency Ratio', key: 'efficiencyRatio', type: 'percent' },
          { label: 'NPLs / Loans', key: 'nplsToLoans', type: 'percent' },
          { label: 'Loan Loss Reserves / Loans', key: 'llrToLoans', type: 'percent' }
        ]
      },
      {
        title: 'Capital',
        rows: [
          { label: 'Total Equity Capital', key: 'totalEquityCapital', type: 'money' },
          { label: 'Tier 1 Capital', key: 'tier1Capital', type: 'money' },
          { label: 'Tier 1 Risk-Based Ratio', key: 'tier1RiskBasedRatio', type: 'percent' },
          { label: 'Total RBC Ratio', key: 'riskBasedCapitalRatio', type: 'percent' },
          { label: 'Leverage Ratio', key: 'leverageRatio', type: 'percent' },
          { label: 'Tangible Equity / Assets', key: 'tangibleEquityToAssets', type: 'percent' }
        ]
      }
    ];
    const rendered = sections.map(section => renderBankSnapshotSection(section, periods)).filter(Boolean).join('');
    if (!rendered) return '';
    return `
      <div class="bank-intel-card bank-intel-card-wide bank-snapshot-card">
        <div class="bank-snapshot-title">
          <h4>THC-Style Bank Snapshot</h4>
          <span>Latest five call-report periods arranged like the Bank Tearsheet export.</span>
        </div>
        <div class="bank-snapshot-grid">
          ${rendered}
        </div>
      </div>
    `;
  }

  function renderBankMixBar(values) {
    const loans = Math.max(0, intelligenceNumber(values.loansToAssets) || 0);
    const securities = Math.max(0, intelligenceNumber(values.securitiesToAssets) || 0);
    const liquid = Math.max(0, intelligenceNumber(values.liquidAssetsToAssets) || 0);
    const known = loans + securities + liquid;
    const other = Math.max(0, 100 - known);
    const rows = [
      ['Loans', loans, 'loan'],
      ['Securities', securities, 'securities'],
      ['Liquid Assets', liquid, 'liquid'],
      ['Other', other, 'other']
    ].filter(([, value]) => value > 0);
    return `
      <div class="bank-intel-mix">
        <div class="bank-intel-mix-bar" aria-label="Current balance sheet mix">
          ${rows.map(([label, value, cls]) => `<span class="${escapeHtml(cls)}" style="width:${Math.max(2, Math.min(100, value)).toFixed(2)}%" title="${escapeHtml(label)} ${escapeHtml(formatPercentTile(value, 2))}"></span>`).join('')}
        </div>
        <div class="bank-intel-mix-legend">
          ${rows.map(([label, value, cls]) => `<span><i class="${escapeHtml(cls)}"></i>${escapeHtml(label)} ${escapeHtml(formatPercentTile(value, 1))}</span>`).join('')}
        </div>
      </div>
    `;
  }

  function renderIntelligenceBreakdown(title, rows, total) {
    const cleaned = rows
      .map(row => ({ ...row, amount: intelligenceNumber(row.amount) || 0 }))
      .filter(row => row.amount > 0)
      .sort((a, b) => b.amount - a.amount);
    if (!cleaned.length) return '';
    return `
      <div class="bank-intel-breakdown">
        <h4>${escapeHtml(title)}</h4>
        ${cleaned.slice(0, 8).map(row => {
          const pct = total ? row.amount / total * 100 : 0;
          return `
            <div class="bank-intel-breakdown-row">
              <span>${escapeHtml(row.label)}</span>
              <div><i style="width:${Math.max(3, Math.min(100, pct)).toFixed(2)}%"></i></div>
              <strong>${escapeHtml(formatPercentTile(pct, 1))}</strong>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderBankIntelligencePanel(bank, values, recentPeriods) {
    const latest = recentPeriods && recentPeriods[0] ? recentPeriods[0] : null;
    const prior = recentPeriods && recentPeriods[1] ? recentPeriods[1] : null;
    const priorValues = prior && prior.values ? prior.values : {};
    const securitiesTotal = (intelligenceNumber(values.afsTotal) || 0) + (intelligenceNumber(values.htmTotal) || 0);
    const mbsTotal = sumBankValues(values, ['afsAllMbs', 'htmAllMbs'])
      || sumBankValues(values, ['afsPassThroughRmbs', 'afsOtherRmbs', 'htmPassThroughRmbs', 'htmOtherRmbs']);
    const muniTotal = sumBankValues(values, ['afsMunis', 'htmMunis']);
    const agenciesTotal = sumBankValues(values, ['afsAgencyCorp', 'htmAgencyCorp']);
    const treasuryTotal = sumBankValues(values, ['afsTreasury', 'htmTreasury']);
    const otherSecurities = Math.max(0, securitiesTotal - [mbsTotal, muniTotal, agenciesTotal, treasuryTotal].reduce((sum, value) => sum + (value || 0), 0));
    const loansTotal = intelligenceNumber(values.totalLoans) || 0;
    const loanRows = [
      { label: 'Real Estate', pct: intelligenceNumber(values.realEstateLoansToLoans) },
      { label: 'C&I', pct: intelligenceNumber(values.ciLoansToLoans) },
      { label: 'Farm / Ag', pct: (intelligenceNumber(values.farmLoansToLoans) || 0) + (intelligenceNumber(values.agProdLoansToLoans) || 0) },
      { label: 'Consumer', pct: intelligenceNumber(values.consumerLoansToLoans) }
    ].filter(row => row.pct != null && row.pct > 0);
    const loanKnown = loanRows.reduce((sum, row) => sum + row.pct, 0);
    if (loanKnown < 100 && loanKnown > 0) loanRows.push({ label: 'Other Loans', pct: Math.max(0, 100 - loanKnown) });
    const qoqAssets = intelligenceNumber(values.totalAssets) !== null && intelligenceNumber(priorValues.totalAssets) !== null
      ? intelligenceNumber(values.totalAssets) - intelligenceNumber(priorValues.totalAssets)
      : null;
    const qoqDeposits = intelligenceNumber(values.totalDeposits) !== null && intelligenceNumber(priorValues.totalDeposits) !== null
      ? intelligenceNumber(values.totalDeposits) - intelligenceNumber(priorValues.totalDeposits)
      : null;
    const portfolioMeta = bank && bank.bondAccounting && bank.bondAccounting.available ? bank.bondAccounting : null;
    const peerLabel = bank && bank.peerComparison && bank.peerComparison.peerGroup ? bank.peerComparison.peerGroup.label : '';
    return `
      <details class="bank-section bank-intelligence-section bank-intelligence-details">
        <summary class="bank-section-title">
          <span>Portfolio Snapshot & THC Feed</span>
          <em>Open / close</em>
        </summary>
        <div class="bank-intel-head">
          <div>
            <strong>${escapeHtml(latest && latest.period ? `Latest call report ${latest.period}` : 'Latest call report')}</strong>
            <span>${escapeHtml(peerLabel ? `Peer cohort: ${peerLabel}` : 'Peer cohort appears after averaged-series import.')}</span>
          </div>
          <div class="bank-intel-actions">
            <button type="button" class="text-btn" data-bank-assistant-action="call">AI Call Prep</button>
            <button type="button" class="text-btn" id="bankIntelPortfolioReportBtn">Open Portfolio Review</button>
          </div>
        </div>
        <div class="bank-intel-grid">
          <div class="bank-intel-card bank-intel-card-wide">
            <h4>Current Balance Sheet Mix</h4>
            ${renderBankMixBar(values)}
          </div>
          <div class="bank-intel-card">
            <h4>Snapshot</h4>
            <div class="bank-intel-tiles">
              ${intelligenceMetricTile('Assets', formatBankValue(values.totalAssets, 'money'), qoqAssets === null ? 'QoQ unavailable' : `QoQ ${formatIntelligenceDelta(qoqAssets, 'money')}`)}
              ${intelligenceMetricTile('Deposits', formatBankValue(values.totalDeposits, 'money'), qoqDeposits === null ? 'QoQ unavailable' : `QoQ ${formatIntelligenceDelta(qoqDeposits, 'money')}`)}
              ${intelligenceMetricTile('Securities / Assets', formatBankValue(values.securitiesToAssets, 'percent'), `Peer ${formatBankValue(intelligencePeer(bank, 'securitiesToAssets') && intelligencePeer(bank, 'securitiesToAssets').peerValue, 'percent')}`)}
              ${intelligenceMetricTile('Loans / Deposits', formatBankValue(values.loansToDeposits, 'percent'), `Peer ${formatBankValue(intelligencePeer(bank, 'loansToDeposits') && intelligencePeer(bank, 'loansToDeposits').peerValue, 'percent')}`)}
            </div>
          </div>
          <div class="bank-intel-card">
            <h4>Peer Analytics</h4>
            ${renderBankIntelligencePeerRows(bank, values)}
          </div>
          ${renderBankPerformanceSnapshot(recentPeriods)}
          <div class="bank-intel-card">
            ${renderIntelligenceBreakdown('Securities Mix', [
              { label: 'Agencies / Corporates', amount: agenciesTotal },
              { label: 'Municipals', amount: muniTotal },
              { label: 'MBS / Structured', amount: mbsTotal },
              { label: 'Treasuries', amount: treasuryTotal },
              { label: 'Other', amount: otherSecurities }
            ], securitiesTotal) || '<h4>Securities Mix</h4><div class="bank-search-empty">No securities mix available.</div>'}
          </div>
          <div class="bank-intel-card">
            ${renderIntelligenceBreakdown('Loan Mix', loanRows.map(row => ({ label: row.label, amount: loansTotal ? loansTotal * row.pct / 100 : row.pct })), loansTotal || 100) || '<h4>Loan Mix</h4><div class="bank-search-empty">No loan mix available.</div>'}
          </div>
          <div class="bank-intel-card bank-intel-card-wide">
            <h4>THC Portfolio Feed</h4>
            <div id="bankPortfolioIntelligenceMount" class="bank-intel-portfolio">
              ${portfolioMeta
                ? `<div class="bank-search-empty">Loading matched THC portfolio workbook summary for ${escapeHtml(formatShortDate(portfolioMeta.latestReportDate || ''))}...</div>`
                : '<div class="bank-search-empty">No THC bond-accounting workbook is matched to this bank yet.</div>'}
            </div>
          </div>
        </div>
      </details>
    `;
  }

  async function loadBankIntelligence(bankId) {
    const requestId = ++bankIntelligenceRequestId;
    bankIntelligenceLoading = false;
    const mount = document.getElementById('bankPortfolioIntelligenceMount');
    const portfolioBtn = document.getElementById('bankIntelPortfolioReportBtn');
    if (portfolioBtn) portfolioBtn.addEventListener('click', () => openBankReportBuilder('portfolio-peer'));
    const bank = selectedBank && selectedBank.bank && String(selectedBank.bank.id) === String(bankId) ? selectedBank.bank : null;
    if (!mount || !bank || !bank.bondAccounting || !bank.bondAccounting.available) return;
    bankIntelligenceLoading = true;
    try {
      let data = bankIntelligenceCache.get(String(bankId));
      if (!data) {
        const res = await fetch(`/api/portfolio-review?bankId=${encodeURIComponent(bankId)}&limit=4`, { cache: 'no-store' });
        data = await readBankJson(res);
        bankIntelligenceCache.set(String(bankId), data);
      }
      if (requestId !== bankIntelligenceRequestId) return;
      mount.innerHTML = renderBankPortfolioIntelligence(data);
    } catch (err) {
      if (requestId !== bankIntelligenceRequestId) return;
      mount.innerHTML = `<div class="bank-search-empty">${escapeHtml(err.message || 'Could not load portfolio intelligence.')}</div>`;
    } finally {
      // Only the latest request clears the flag, so a stale load finishing
      // doesn't mark a newer in-flight one as done.
      if (requestId === bankIntelligenceRequestId) bankIntelligenceLoading = false;
    }
  }

  function renderBankPortfolioIntelligence(data) {
    if (!data || data.available === false) {
      return `<div class="bank-search-empty">${escapeHtml(data && data.notice || 'No parsed portfolio workbook is available.')}</div>`;
    }
    const summary = data.summary || {};
    const topFlags = Array.isArray(data.flags) ? data.flags.slice(0, 4) : [];
    const topLosses = data.screens && Array.isArray(data.screens.topLosses) ? data.screens.topLosses.slice(0, 4) : [];
    return `
      <div class="bank-intel-portfolio-grid">
        ${intelligenceMetricTile('Market Value', formatMoney(summary.marketValue), `${formatNumber(summary.positions)} positions`)}
        ${intelligenceMetricTile('Unrealized G/L', formatMoney(summary.gainLoss), formatPercentTile(summary.gainLossPct, 2), (summary.gainLoss || 0) < 0 ? 'warn' : 'good')}
        ${intelligenceMetricTile('Book Yield', formatReviewYield(summary.bookYield), `Market ${formatReviewYield(summary.marketYield)}`)}
        ${intelligenceMetricTile('WAL / Duration', [summary.weightedAverageLife != null ? summary.weightedAverageLife.toFixed(2) : '', summary.effectiveDuration != null ? summary.effectiveDuration.toFixed(2) : ''].filter(Boolean).join(' / ') || '—', 'Weighted average')}
      </div>
      <div class="bank-intel-portfolio-body">
        <div>
          <h5>Review Flags</h5>
          <div class="bank-intel-flag-list">
            ${topFlags.length ? topFlags.map(flag => `
              <span class="${flag.severity === 'High' ? 'high' : ''}">
                <strong>${escapeHtml(flag.type || 'Flag')}</strong>
                <em>${escapeHtml(flag.text || '')}</em>
              </span>
            `).join('') : '<div class="bank-search-empty">No portfolio flags surfaced.</div>'}
          </div>
        </div>
        <div>
          <h5>Largest Loss Positions</h5>
          ${topLosses.length ? `
            <div class="bank-intel-loss-list">
              ${topLosses.map(row => `
                <div>
                  <span>${escapeHtml(row.cusip || '')}</span>
                  <strong>${escapeHtml(row.description || 'Holding')}</strong>
                  <em>${escapeHtml([formatMoney(row.gainLoss), formatPercentTile(row.gainLossPct, 2), row.sector].filter(Boolean).join(' · '))}</em>
                </div>
              `).join('')}
            </div>
          ` : '<div class="bank-search-empty">No loss positions parsed.</div>'}
        </div>
      </div>
      ${bankPortfolioAnalyticsHighlights(data.analytics || {})}
    `;
  }

  function bankPortfolioAnalyticsHighlights(analytics) {
    const scenarios = Array.isArray(analytics.scenarioSummary) ? analytics.scenarioSummary : [];
    const peerRows = Array.isArray(analytics.peerReview) ? analytics.peerReview : [];
    const krdRows = Array.isArray(analytics.keyRateDuration) ? analytics.keyRateDuration : [];
    if (!scenarios.length && !peerRows.length && !krdRows.length) return '';
    const base = scenarios.find(row => Number(row.shock) === 0);
    const up300 = scenarios.find(row => Number(row.shock) === 300);
    const down300 = scenarios.find(row => Number(row.shock) === -300);
    const investments = krdRows.find(row => /^investments$/i.test(row.label));
    const peerOutliers = peerRows
      .map(row => ({
        row,
        gap: row.allocationPct != null && row.peerAllocationPct != null
          ? Math.abs(row.allocationPct - row.peerAllocationPct)
          : null
      }))
      .filter(item => item.gap != null)
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 3);
    return `
      <div class="bank-intel-analytics">
        <h5>Scenario Readout</h5>
        <div class="bank-intel-analytics-grid">
          ${base ? intelligenceMetricTile('Base Market Value', formatMoney(base.marketValue), `G/L ${formatMoney(base.gainLoss)}`) : ''}
          ${up300 ? intelligenceMetricTile('+300 bp Shock', formatMoney(up300.marketValue), `Price ${formatPercentTile(up300.priceChangePct, 2)}`, (up300.gainLoss || 0) < 0 ? 'warn' : '') : ''}
          ${down300 ? intelligenceMetricTile('-300 bp Shock', formatMoney(down300.marketValue), `Price ${formatPercentTile(down300.priceChangePct, 2)}`) : ''}
          ${investments ? intelligenceMetricTile('Key Rate Duration', investments.values && investments.values['Eff. Dur'] != null ? Number(investments.values['Eff. Dur']).toFixed(2) : '—', 'Investments total') : ''}
        </div>
        ${peerOutliers.length ? `
          <div class="bank-intel-peer-outliers">
            ${peerOutliers.map(item => `
              <span>${escapeHtml(item.row.sector)} allocation ${escapeHtml(formatPercentTile(item.row.allocationPct, 1))} vs peer ${escapeHtml(formatPercentTile(item.row.peerAllocationPct, 1))}</span>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderBankUploadedFilesPanel(bank) {
    const bondAccounting = bank && bank.bondAccounting;
    const portfolios = bondAccounting && Array.isArray(bondAccounting.portfolios) ? bondAccounting.portfolios : [];
    const title = `Uploaded Files${bondAccounting && bondAccounting.latestReportDate ? ` · latest bond report ${formatShortDate(bondAccounting.latestReportDate)}` : ''}`;
    if (!portfolios.length) {
      return `
        <section class="bank-section bank-uploaded-files-section">
          <div class="bank-section-title">${escapeHtml(title)}</div>
          <div class="bank-uploaded-file-group">
            <div class="bank-uploaded-file-head">
              <strong>Bond Accounting Reports</strong>
              <span>Matched from the Reports workspace import.</span>
            </div>
            <div class="bank-search-empty">
              No monthly bond accounting report has been matched to this bank yet.
              <button type="button" class="text-btn" data-goto="reports">Import bond accounting files</button>
            </div>
          </div>
        </section>
      `;
    }
    return `
      <section class="bank-section bank-uploaded-files-section">
        <div class="bank-section-title">${escapeHtml(title)}</div>
        <div class="bank-uploaded-file-group">
          <div class="bank-uploaded-file-head">
            <strong>Bond Accounting Reports</strong>
            <span>${escapeHtml(formatNumber(portfolios.length))} matched monthly report${portfolios.length === 1 ? '' : 's'}</span>
          </div>
          <div class="bank-bond-list">
            ${portfolios.map(row => `
              <div class="bank-bond-item">
                <div>
                  <small class="bank-uploaded-file-kind">Monthly Bond Accounting Report</small>
                  <strong>${escapeHtml(row.filename || 'Portfolio workbook')}</strong>
                  <span>${escapeHtml([row.pCode, row.reportDate ? formatShortDate(row.reportDate) : '', row.account ? `Account ${row.account}` : '', row.matchedBy].filter(Boolean).join(' · '))}</span>
                </div>
                <a class="text-btn" href="${bondAccountingFileUrl(row)}" target="_blank" rel="noopener">Open</a>
              </div>
            `).join('')}
          </div>
        </div>
      </section>
    `;
  }

  async function loadBankStrategyHistory(bankId) {
    strategyHistoryLists().forEach(list => {
      list.innerHTML = '<div class="bank-search-empty">Loading strategy history...</div>';
    });
    try {
      const res = await fetch(`/api/strategies?bankId=${encodeURIComponent(bankId)}&archived=all`, { cache: 'no-store' });
      const data = await readBankJson(res);
      selectedBankStrategyHistory = Array.isArray(data.requests) ? data.requests : [];
      renderBankStrategyHistory();
    } catch (e) {
      selectedBankStrategyHistory = [];
      renderBankStrategyHistory(e.message);
    }
  }

  function currentVisibleStrategyHistoryBankId() {
    return activeBankWorkspaceView === 'coverage' ? activeCoverageBankId : selectedBankId();
  }

  function refreshVisibleStrategyHistoryForRequest(request) {
    const bankId = currentVisibleStrategyHistoryBankId();
    if (bankId && request && String(request.bankId) === String(bankId)) {
      loadBankStrategyHistory(bankId);
    }
  }

  function strategyHistoryLists() {
    const lists = [...document.querySelectorAll('[data-strategy-history-list]')];
    const visible = lists.filter(list => !list.closest('[hidden]'));
    return visible.length ? visible : lists;
  }

  function renderBankStrategyHistoryPanel(listId = 'bankStrategyHistoryList') {
    return `
      <section class="bank-section bank-strategy-history">
        <div class="bank-section-title">Strategy Request History</div>
        <div class="bank-strategy-history-list" id="${escapeHtml(listId)}" data-strategy-history-list>
          <div class="bank-search-empty">Loading strategy history...</div>
        </div>
      </section>
    `;
  }

  function renderBankStrategyHistory(errorMessage) {
    const lists = strategyHistoryLists();
    if (!lists.length) return;
    if (errorMessage) {
      lists.forEach(list => {
        list.innerHTML = `<div class="bank-search-empty">${escapeHtml(errorMessage)}</div>`;
      });
      return;
    }
    if (!selectedBankStrategyHistory.length) {
      lists.forEach(list => {
        list.innerHTML = '<div class="bank-search-empty">No strategy requests for this bank yet.</div>';
      });
      return;
    }
    const html = selectedBankStrategyHistory.map(row => `
      <article class="bank-strategy-history-item" data-bank-strategy-history-item="${escapeHtml(row.id)}">
        <div>
          <div class="strategy-card-head">
            <strong>${escapeHtml(row.requestType || 'Miscellaneous')}</strong>
            <span>
              ${row.isArchived ? '<em class="strategy-archive-badge">Archived</em>' : ''}
              <em class="bank-pill ${coverageClass(row.status)}">${escapeHtml(row.status || 'Open')}</em>
            </span>
          </div>
          <p>${escapeHtml(row.summary || 'Strategy request')}</p>
          ${row.comments ? `<div class="strategy-card-comments">${escapeHtml(row.comments).replace(/\n/g, '<br>')}</div>` : ''}
          ${renderStrategyFiles(row)}
          <div class="strategy-card-meta">
            <span>Priority ${escapeHtml(row.priority || '3')}/5</span>
            ${row.requestedBy ? `<span>By ${escapeHtml(row.requestedBy)}</span>` : ''}
            ${row.assignedTo ? `<span>Owner ${escapeHtml(row.assignedTo)}</span>` : ''}
            ${row.invoiceContact ? `<span>Invoice ${escapeHtml(row.invoiceContact)}</span>` : ''}
            <span>Updated ${escapeHtml(formatFullTimestamp(row.updatedAt))}</span>
          </div>
          <div class="strategy-history-upload">
            <div class="strategy-file-upload compact" data-strategy-drop>
              <div>
                <span>Attach File</span>
                <strong data-strategy-file-name>No file selected</strong>
                <small>Drop or choose the final report for this request.</small>
              </div>
              <input type="file" data-strategy-file accept=".pdf,.xlsx,.xlsm,.xlsb,.xls,.docx,.csv">
            </div>
            <button type="button" class="text-btn" data-bank-strategy-upload="${escapeHtml(row.id)}">Upload File</button>
          </div>
        </div>
        <button type="button" class="text-btn" data-bank-strategy-open="${escapeHtml(row.id)}">Open in Queue</button>
      </article>
    `).join('');
    lists.forEach(list => {
      list.innerHTML = html;
      wireStrategyDropZones(list);
      list.querySelectorAll('[data-bank-strategy-upload]').forEach(btn => {
        btn.addEventListener('click', () => {
          const item = btn.closest('[data-bank-strategy-history-item]');
          const input = item ? item.querySelector('[data-strategy-file]') : null;
          uploadStrategyFileFromInput(btn.dataset.bankStrategyUpload, input);
        });
      });
      list.querySelectorAll('[data-bank-strategy-open]').forEach(btn => {
        btn.addEventListener('click', () => {
          goTo('strategies');
          const search = document.getElementById('strategySearchInput');
          const archive = document.getElementById('strategyArchiveFilter');
          if (archive) archive.value = 'all';
          if (search) search.value = btn.dataset.bankStrategyOpen || '';
          loadStrategies();
        });
      });
    });
  }

  function renderBankStrategyRequestPanel() {
    const currentStatus = currentBankAccountStatus().status || 'Open';
    return `
      <section class="bank-section bank-strategy-request" id="bankStrategyRequestPanel" hidden>
        <div class="bank-section-title">New Strategy Request</div>
        <div class="strategy-request-grid">
          <label>
            <span>Request Type</span>
            <select id="bankStrategyType">${coverageSelectOptions(STRATEGY_TYPES, 'Muni BCIS')}</select>
          </label>
          <label>
            <span>Priority</span>
            <select id="bankStrategyPriority">${coverageSelectOptions(STRATEGY_PRIORITIES, '3')}</select>
          </label>
          <label>
            <span>Requested By</span>
            <input type="text" id="bankStrategyRequestedBy" placeholder="Name">
          </label>
          <label>
            <span>Assigned To</span>
            <input type="text" id="bankStrategyAssignedTo" value="Strategies" placeholder="Owner">
          </label>
          <label>
            <span>Invoice Contact</span>
            <input type="text" id="bankStrategyInvoiceContact" placeholder="Person to address invoice">
          </label>
          <label>
            <span>Bank Status</span>
            <input type="text" value="${escapeHtml(currentStatus)}" disabled>
          </label>
          <label class="wide">
            <span>Summary</span>
            <input type="text" id="bankStrategySummary" placeholder="Brief request title">
          </label>
          <label class="wide">
            <span>Comments</span>
            <textarea id="bankStrategyComments" rows="4" placeholder="Portfolio notes, timing, deliverables, billing notes, or context from the banker"></textarea>
          </label>
          <div class="wide strategy-file-upload" data-strategy-drop>
            <div>
              <span>Optional File</span>
              <strong data-strategy-file-name>No file selected</strong>
              <small>Attach a final swap, BCIS, THO, CECL, PDF, workbook, Word doc, or CSV with this request.</small>
            </div>
            <input type="file" id="bankStrategyFile" data-strategy-file accept=".pdf,.xlsx,.xlsm,.xlsb,.xls,.docx,.csv">
          </div>
        </div>
        <div class="bank-coverage-actions">
          <button type="button" class="small-btn" id="bankStrategySubmitBtn">Submit Request</button>
          <button type="button" class="text-btn" id="bankStrategyCancelBtn">Cancel</button>
          <span class="bank-coverage-status">Requests land in the Strategies Queue.</span>
        </div>
      </section>
    `;
  }

  function assistantActionLabel(action) {
    if (action === 'summary') return 'Snapshot';
    if (action === 'call') return 'Call prep';
    if (action === 'note') return 'Draft note';
    return 'What fits today';
  }

  function renderBankAssistantPanel() {
    return `
      <details class="bank-section bank-assistant-section bank-assistant-details" id="bankAssistantPanel">
        <summary class="bank-section-title">
          <span>Sales Assistant</span>
          <em>Open / close</em>
        </summary>
        <div class="bank-assistant-head">
          <div>
            <p>Reads this bank's latest call report, coverage status, strategy history, and today's offering inventory — and tells you who to call, what to pitch, and why.</p>
          </div>
          <span class="bank-assistant-badge">Internal</span>
        </div>
        <div class="bank-assistant-prompts">
          <button type="button" class="small-btn bank-assistant-prompt primary" data-bank-assistant-action="fit">${assistantActionLabel('fit')}</button>
          <button type="button" class="small-btn bank-assistant-prompt" data-bank-assistant-action="summary">${assistantActionLabel('summary')}</button>
          <button type="button" class="small-btn bank-assistant-prompt" data-bank-assistant-action="call">${assistantActionLabel('call')}</button>
          <button type="button" class="small-btn bank-assistant-prompt" data-bank-assistant-action="note">${assistantActionLabel('note')}</button>
        </div>
        <div class="bank-assistant-output" id="bankAssistantOutput">
          <div class="bank-assistant-empty">
            <strong>Pick a prompt to get a readout.</strong>
            <span>Short, internal — built from this bank's latest filings and today's parsed inventory. Not for client use.</span>
          </div>
        </div>
      </details>
    `;
  }

  function renderAssistantItem(item) {
    if (item && typeof item === 'object') {
      const text = escapeHtml(item.text || '');
      const link = item.explorerPage
        ? ` <button type="button" class="linklike bank-assistant-fit-link" data-assistant-explorer="${escapeHtml(item.explorerPage)}">${escapeHtml(item.explorerLabel || 'Open explorer')} ›</button>`
        : '';
      return `<li>${text}${link}</li>`;
    }
    return `<li>${escapeHtml(String(item || ''))}</li>`;
  }

  function compactMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(abs >= 10000000 ? 0 : 1)}MM`;
    if (abs >= 1000) return `${sign}$${Math.round(abs / 1000)}K`;
    return `${sign}$${Math.round(abs)}`;
  }

  function renderSwapCandidateCards(candidates) {
    if (!Array.isArray(candidates) || !candidates.length) return '';
    return `
      <div class="bank-assistant-swap-grid">
        ${candidates.map((candidate, index) => {
          const held = candidate.held || {};
          const offering = candidate.offering || {};
          const econ = candidate.economics || {};
          const heldTitle = [held.cusip, held.description].filter(Boolean).join(' · ') || 'Current holding';
          const realized = econ.realizedGainLoss == null ? held.gainLoss : econ.realizedGainLoss;
          const breakeven = econ.breakevenMonths == null ? 'N/A' : `${Number(econ.breakevenMonths).toFixed(1)} mo`;
          const horizon = econ.horizonYears == null ? '' : `${Number(econ.horizonYears).toFixed(2)} yr horizon`;
          return `
            <article class="bank-assistant-swap-card">
              <div class="bank-assistant-swap-head">
                <span>Swap Candidate ${index + 1}</span>
                <strong>${escapeHtml(candidate.sector || 'Portfolio')}</strong>
              </div>
              <div class="bank-assistant-swap-main">
                <div>
                  <span>Sell</span>
                  <strong>${escapeHtml(heldTitle)}</strong>
                  <em>${escapeHtml([held.par ? compactMoney(held.par) + ' par' : '', `${Number(held.bookYield || 0).toFixed(2)}% book`, `${Number(held.marketYield || 0).toFixed(2)}% market`].filter(Boolean).join(' · '))}</em>
                </div>
                <div>
                  <span>Buy</span>
                  <strong>${escapeHtml(offering.label || 'Replacement offering')}</strong>
                  <em>${escapeHtml(offering.yield == null ? 'Yield pending' : `${Number(offering.yield).toFixed(3)}% replacement yield`)}</em>
                </div>
              </div>
              <dl class="bank-assistant-swap-metrics">
                <div><dt>Pickup</dt><dd>${escapeHtml(candidate.yieldPickupVsBook == null ? '—' : `+${Number(candidate.yieldPickupVsBook).toFixed(2)}%`)}</dd></div>
                <div><dt>Breakeven</dt><dd>${escapeHtml(breakeven)}</dd></div>
                <div><dt>Gain/Loss</dt><dd>${escapeHtml(compactMoney(realized))}</dd></div>
                <div><dt>Annual Pickup</dt><dd>${escapeHtml(compactMoney(econ.annualIncomePickup))}</dd></div>
                <div><dt>Net Benefit</dt><dd>${escapeHtml(compactMoney(econ.netBenefitToHorizon))}</dd></div>
                <div><dt>Horizon</dt><dd>${escapeHtml(horizon || '—')}</dd></div>
              </dl>
              <button type="button" class="text-btn bank-assistant-swap-action" data-assistant-swap-strategy="${index}">Create strategy request</button>
            </article>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderAssistantResponse(data) {
    const output = document.getElementById('bankAssistantOutput');
    if (!output) return;
    if (!data) {
      output.innerHTML = '<div class="bank-search-empty">No assistant response yet.</div>';
      return;
    }
    output.classList.remove('is-loading');
    const sections = (Array.isArray(data.sections) ? data.sections : [])
      .filter(section => String(section && section.title || '').toLowerCase() !== 'swap candidates');
    const swapCards = renderSwapCandidateCards(data.swapCandidates);
    const pill = data.statusPill;
    const pillHtml = pill && pill.status
      ? `<span class="bank-assistant-status-pill maps-status-pill maps-status-${escapeHtml(pill.slug || 'open')}" title="${escapeHtml(pill.owner ? 'Owner: ' + pill.owner : '')}">${escapeHtml(pill.status)}</span>`
      : '';
    const notices = Array.isArray(data.notices) ? data.notices : [];
    const noticesHtml = notices.length
      ? notices.map(n => `<div class="bank-assistant-notice bank-assistant-notice-${escapeHtml(n.tone || 'info')}">${escapeHtml(n.text)}</div>`).join('')
      : '';
    output.innerHTML = `
      <article class="bank-assistant-card">
        <div class="bank-assistant-card-head">
          <div>
            <strong>${escapeHtml(data.title || 'Sales readout')} ${pillHtml}</strong>
            ${data.subtitle ? `<span>${escapeHtml(data.subtitle)}</span>` : ''}
          </div>
          ${data.context && data.context.asOfDate ? `<em>${escapeHtml(data.context.asOfDate)}</em>` : ''}
        </div>
        ${noticesHtml}
        ${data.summary ? `<p class="bank-assistant-summary">${escapeHtml(data.summary)}</p>` : ''}
        ${swapCards}
        ${sections.map(section => `
          <div class="bank-assistant-block">
            <h4>${escapeHtml(section.title || 'Notes')}</h4>
            <ul>
              ${(Array.isArray(section.items) ? section.items : []).filter(Boolean).map(renderAssistantItem).join('')}
            </ul>
          </div>
        `).join('')}
        ${data.callNote ? `
          <div class="bank-assistant-note">
            <div class="bank-assistant-note-head">
              <strong>Call note</strong>
              <button type="button" class="text-btn" id="bankAssistantCopyBtn">Copy</button>
            </div>
            <pre>${escapeHtml(data.callNote)}</pre>
          </div>
        ` : ''}
        <div class="bank-assistant-actions">
          <button type="button" class="small-btn" id="bankAssistantStrategyBtn">${Array.isArray(data.swapCandidates) && data.swapCandidates.length ? 'Open top swap as strategy' : 'Open as strategy request'}</button>
          ${data.holdings && data.holdings.latestStoredPath
            ? `<a class="small-btn" href="/api/banks/bond-accounting/files/${encodeURIComponent(data.holdings.latestStoredPath)}" target="_blank" rel="noopener">View holdings${data.holdings.totalPositions ? ` (${escapeHtml(data.holdings.totalPositions)} positions · ${escapeHtml(data.holdings.reportDate || 'on file')})` : ` (${escapeHtml(data.holdings.reportDate || 'on file')})`}</a>`
            : ''}
          ${data.disclaimer ? `<span>${escapeHtml(data.disclaimer)}</span>` : ''}
        </div>
      </article>
    `;
    document.getElementById('bankAssistantCopyBtn')?.addEventListener('click', copyBankAssistantNote);
    document.getElementById('bankAssistantStrategyBtn')?.addEventListener('click', useAssistantInStrategyRequest);
    output.querySelectorAll('[data-assistant-swap-strategy]').forEach(btn => {
      btn.addEventListener('click', () => useAssistantInStrategyRequest(Number(btn.dataset.assistantSwapStrategy || 0)));
    });
    output.querySelectorAll('[data-assistant-explorer]').forEach(link => {
      link.addEventListener('click', evt => {
        evt.preventDefault();
        const page = link.getAttribute('data-assistant-explorer');
        if (page) goTo(page);
      });
    });
  }

  async function runBankAssistant(action = 'fit') {
    const bankId = selectedBankId();
    const output = document.getElementById('bankAssistantOutput');
    if (!bankId) return showToast('No bank selected', true);
    const hasContent = output && output.querySelector('.bank-assistant-card');
    if (output) {
      output.classList.add('is-loading');
      if (!hasContent) {
        output.innerHTML = `<div class="bank-search-empty">Building ${escapeHtml(assistantActionLabel(action).toLowerCase())}…</div>`;
      }
    }
    document.querySelectorAll('[data-bank-assistant-action]').forEach(btn => {
      const isActive = btn.dataset.bankAssistantAction === action;
      btn.classList.toggle('active', isActive);
      btn.disabled = true;
      if (isActive) {
        if (!btn.dataset.originalLabel) btn.dataset.originalLabel = btn.textContent;
        btn.textContent = 'Working…';
      }
    });
    try {
      const res = await fetch('/api/assistant/bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankId, action })
      });
      bankAssistantLastResponse = await readBankJson(res);
      bankAssistantCache.set(bankId, bankAssistantLastResponse);
      renderAssistantResponse(bankAssistantLastResponse);
    } catch (e) {
      if (output) {
        output.classList.remove('is-loading');
        if (!hasContent) output.innerHTML = `<div class="bank-search-empty">${escapeHtml(e.message)}</div>`;
      }
      showToast(e.message, true);
    } finally {
      document.querySelectorAll('[data-bank-assistant-action]').forEach(btn => {
        btn.disabled = false;
        if (btn.dataset.originalLabel) {
          btn.textContent = btn.dataset.originalLabel;
          delete btn.dataset.originalLabel;
        }
      });
      if (output) output.classList.remove('is-loading');
    }
  }

  function ensureBuyersDrawer() {
    let backdrop = document.getElementById('buyersDrawerBackdrop');
    if (backdrop) return backdrop;
    backdrop = document.createElement('div');
    backdrop.id = 'buyersDrawerBackdrop';
    backdrop.className = 'maps-modal-backdrop buyers-drawer-backdrop';
    backdrop.hidden = true;
    backdrop.innerHTML = `
      <div class="maps-modal buyers-drawer" role="dialog" aria-modal="true" aria-labelledby="buyersDrawerTitle">
        <header>
          <div>
            <div class="title" id="buyersDrawerTitle">Who buys this?</div>
            <div class="buyers-drawer-subtitle" id="buyersDrawerSubtitle"></div>
          </div>
          <button type="button" class="text-btn" id="buyersDrawerClose" aria-label="Close">✕</button>
        </header>
        <div class="maps-modal-body" id="buyersDrawerBody">
          <div class="bank-search-empty">Scoring covered banks…</div>
        </div>
        <footer>
          <span class="buyers-drawer-disclaimer">Coverage banks only — scored on call-report fit + status. Internal sales support.</span>
          <button type="button" class="small-btn" id="buyersDrawerCloseFooter">Close</button>
        </footer>
      </div>`;
    document.body.appendChild(backdrop);
    const close = () => { backdrop.hidden = true; };
    backdrop.querySelector('#buyersDrawerClose').addEventListener('click', close);
    backdrop.querySelector('#buyersDrawerCloseFooter').addEventListener('click', close);
    backdrop.addEventListener('click', evt => { if (evt.target === backdrop) close(); });
    document.addEventListener('keydown', evt => { if (evt.key === 'Escape' && !backdrop.hidden) close(); });
    return backdrop;
  }

  function renderBuyersList(data) {
    const body = document.getElementById('buyersDrawerBody');
    if (!body) return;
    if (!data || !Array.isArray(data.buyers) || !data.buyers.length) {
      body.innerHTML = `<div class="bank-search-empty">${escapeHtml(data && data.notice ? data.notice : 'No coverage banks matched this offering.')}</div>`;
      return;
    }
    body.innerHTML = `
      <div class="buyers-summary">${escapeHtml(data.buyers.length)} of ${escapeHtml(data.coverageCount)} covered banks ranked.</div>
      <ol class="buyers-list">
        ${data.buyers.map((b, i) => `
          <li class="buyer-row">
            <div class="buyer-rank">${i + 1}</div>
            <div class="buyer-main">
              <div class="buyer-name">
                <button type="button" class="linklike" data-buyers-bank-id="${escapeHtml(b.bankId)}">${escapeHtml(b.displayName)}</button>
                <span class="maps-status-pill maps-status-${escapeHtml(b.statusSlug || 'open')}">${escapeHtml(b.status)}</span>
              </div>
              <div class="buyer-meta">${escapeHtml([b.location, b.period, b.owner ? `Owner: ${b.owner}` : ''].filter(Boolean).join(' · '))}</div>
              <div class="buyer-rationale">${b.rationale.map(r => `<span class="buyer-chip">${escapeHtml(r)}</span>`).join('')}</div>
            </div>
            <div class="buyer-score">${escapeHtml(b.score)}</div>
          </li>
        `).join('')}
      </ol>`;
    body.querySelectorAll('[data-buyers-bank-id]').forEach(a => {
      a.addEventListener('click', evt => {
        evt.preventDefault();
        document.getElementById('buyersDrawerBackdrop').hidden = true;
        goTo('banks');
        setTimeout(() => loadBank(a.dataset.buyersBankId), 200);
      });
    });
  }

  async function openBuyersDrawer(productType, offering) {
    const backdrop = ensureBuyersDrawer();
    backdrop.hidden = false;
    const subtitle = document.getElementById('buyersDrawerSubtitle');
    const body = document.getElementById('buyersDrawerBody');
    if (subtitle) subtitle.textContent = '';
    if (body) body.innerHTML = '<div class="bank-search-empty">Scoring covered banks…</div>';
    try {
      const res = await fetch('/api/assistant/buyers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productType, offering, limit: 10 })
      });
      const data = await readBankJson(res);
      if (subtitle) subtitle.textContent = data.offeringHeadline || '';
      renderBuyersList(data);
    } catch (e) {
      if (body) body.innerHTML = `<div class="bank-search-empty">${escapeHtml(e.message)}</div>`;
    }
  }

  function wireBuyersButtons(container, rows) {
    if (!container) return;
    container.querySelectorAll('[data-buyers-product]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.buyersIdx);
        const productType = btn.dataset.buyersProduct;
        const offering = rows[idx];
        if (productType && offering) openBuyersDrawer(productType, offering);
      });
    });
  }

  async function copyBankAssistantNote() {
    const note = bankAssistantLastResponse && bankAssistantLastResponse.callNote;
    const btn = document.getElementById('bankAssistantCopyBtn');
    if (!note) return showToast('No assistant note to copy', true);
    try {
      await navigator.clipboard.writeText(note);
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = 'Copied ✓';
        btn.disabled = true;
        setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1400);
      }
    } catch (_) {
      showToast('Copy failed; select the note text instead', true);
    }
  }

  function swapStrategySummary(data, candidate) {
    const held = candidate && candidate.held ? candidate.held : {};
    const offering = candidate && candidate.offering ? candidate.offering : {};
    const bankName = data && data.title ? data.title : 'Bank';
    const sell = held.cusip || held.description || 'current holding';
    const buy = offering.cusip || offering.label || 'replacement offering';
    return `${bankName}: swap ${sell} into ${buy}`.slice(0, 220);
  }

  function swapStrategyComments(data, candidate) {
    const held = candidate && candidate.held ? candidate.held : {};
    const offering = candidate && candidate.offering ? candidate.offering : {};
    const econ = candidate && candidate.economics ? candidate.economics : {};
    const lines = [
      'Swap candidate from Sales Assistant',
      '',
      `Sell: ${[held.cusip, held.description].filter(Boolean).join(' · ') || 'Current holding'}`,
      `Sell par: ${held.par ? compactMoney(held.par) : 'n/a'}`,
      `Book yield / market yield: ${held.bookYield == null ? 'n/a' : Number(held.bookYield).toFixed(3) + '%'} / ${held.marketYield == null ? 'n/a' : Number(held.marketYield).toFixed(3) + '%'}`,
      `Realized gain/loss: ${compactMoney(econ.realizedGainLoss == null ? held.gainLoss : econ.realizedGainLoss)}`,
      '',
      `Buy: ${offering.label || 'Replacement offering'}`,
      `Replacement yield: ${offering.yield == null ? 'n/a' : Number(offering.yield).toFixed(3) + '%'}`,
      `Yield pickup vs book: ${candidate && candidate.yieldPickupVsBook != null ? '+' + Number(candidate.yieldPickupVsBook).toFixed(2) + '%' : 'n/a'}`,
      `Annual income pickup: ${compactMoney(econ.annualIncomePickup)}`,
      `Net benefit to horizon: ${compactMoney(econ.netBenefitToHorizon)}`,
      `Breakeven: ${econ.breakevenMonths == null ? 'n/a' : Number(econ.breakevenMonths).toFixed(1) + ' months'}`,
      `Horizon: ${econ.horizonYears == null ? 'n/a' : Number(econ.horizonYears).toFixed(2) + ' years'}`,
      '',
      data && data.callNote ? data.callNote : ''
    ];
    return lines.filter((line, index, arr) => line || arr[index - 1]).join('\n').trim();
  }

  function useAssistantInStrategyRequest(candidateIndex = null) {
    const data = bankAssistantLastResponse;
    if (!data || !data.callNote) return showToast('Run the assistant first', true);
    const candidates = Array.isArray(data.swapCandidates) ? data.swapCandidates : [];
    const candidate = candidates.length
      ? candidates[Math.max(0, Math.min(Number(candidateIndex) || 0, candidates.length - 1))]
      : null;
    openBankStrategyRequestPanel();
    const summary = document.getElementById('bankStrategySummary');
    const comments = document.getElementById('bankStrategyComments');
    const type = document.getElementById('bankStrategyType');
    if (summary && !summary.value.trim()) summary.value = candidate ? swapStrategySummary(data, candidate) : (data.summary || 'Assistant follow-up');
    if (comments) {
      const existing = comments.value.trim();
      const next = candidate ? swapStrategyComments(data, candidate) : data.callNote;
      comments.value = [existing, next].filter(Boolean).join(existing ? '\n\n' : '');
    }
    if (type) {
      const topProduct = String(data.topProduct || '').toLowerCase();
      if (candidate) type.value = 'Bond Swap';
      else if (/muni|bcis/.test(topProduct)) type.value = 'Muni BCIS';
      else if (/swap/.test(topProduct)) type.value = 'Bond Swap';
    }
    showToast(candidate ? 'Added swap candidate to strategy request' : 'Added assistant context to strategy request');
  }

  function toggleBankStrategyRequestPanel() {
    const panel = document.getElementById('bankStrategyRequestPanel');
    if (!panel) return;
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      focusBankStrategyRequestSummary();
    }
  }

  function openBankStrategyRequestPanel() {
    const panel = document.getElementById('bankStrategyRequestPanel');
    if (!panel) return;
    panel.hidden = false;
    focusBankStrategyRequestSummary();
  }

  function focusBankStrategyRequestSummary() {
    const summary = document.getElementById('bankStrategySummary');
    if (summary) summary.focus();
  }

  function hideBankStrategyRequestPanel() {
    const panel = document.getElementById('bankStrategyRequestPanel');
    if (panel) panel.hidden = true;
  }

  async function submitCurrentBankStrategyRequest() {
    const bankId = selectedBankId();
    if (!bankId) return showToast('No bank selected', true);
    const requestType = document.getElementById('bankStrategyType')?.value || 'Miscellaneous';
    const summaryEl = document.getElementById('bankStrategySummary');
    const summary = summaryEl ? summaryEl.value.trim() : '';
    const fileInput = document.getElementById('bankStrategyFile');
    const payload = {
      bankId,
      requestType,
      priority: document.getElementById('bankStrategyPriority')?.value || '3',
      requestedBy: document.getElementById('bankStrategyRequestedBy')?.value || '',
      assignedTo: document.getElementById('bankStrategyAssignedTo')?.value || '',
      invoiceContact: document.getElementById('bankStrategyInvoiceContact')?.value || '',
      summary: summary || requestType,
      comments: document.getElementById('bankStrategyComments')?.value || ''
    };
    try {
      const res = await fetch('/api/strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await readBankJson(res);
      if (data.request) {
        strategyRequests = [data.request, ...strategyRequests.filter(row => row.id !== data.request.id)];
        STRATEGY_STATUSES.forEach(status => {
          strategyCounts[status] = strategyRequests.filter(row => row.status === status).length;
        });
        if (fileInput && fileInput.files && fileInput.files[0]) {
          await uploadStrategyFileFromInput(data.request.id, fileInput, { silent: true });
        }
      }
      resetBankStrategyRequestForm();
      hideBankStrategyRequestPanel();
      renderStrategyBoard();
      await loadStrategyNotifications();
      await loadBankStrategyHistory(bankId);
      showToast('Submitted strategy request');
    } catch (e) {
      showToast(e.message, true);
    }
  }

  function resetBankStrategyRequestForm() {
    const fields = [
      'bankStrategyRequestedBy',
      'bankStrategyInvoiceContact',
      'bankStrategySummary',
      'bankStrategyComments'
    ];
    fields.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const assigned = document.getElementById('bankStrategyAssignedTo');
    const type = document.getElementById('bankStrategyType');
    const priority = document.getElementById('bankStrategyPriority');
    if (assigned) assigned.value = 'Strategies';
    if (type) type.value = 'Muni BCIS';
    if (priority) priority.value = '3';
    const file = document.getElementById('bankStrategyFile');
    if (file) {
      file.value = '';
      updateStrategyDropFileName(file.closest('[data-strategy-drop]'), null);
    }
  }

  function renderBankCoverageSection() {
    const saved = selectedBankCoverage || {};
    const status = saved.status || selectedBankAccountStatus?.status || 'Open';
    const priority = saved.priority || 'Medium';
    return `
      <div class="bank-coverage-detail-head">
        <div>
          <span class="tool-eyebrow">Coverage Workspace</span>
          <h3>${escapeHtml(saved.displayName || 'Saved Bank')}</h3>
          <p>${escapeHtml([saved.city, saved.state, saved.certNumber ? `Cert ${saved.certNumber}` : '', saved.primaryRegulator].filter(Boolean).join(' · '))}</p>
        </div>
        <button type="button" class="small-btn" id="bankCoverageOpenTearSheetBtn">Open Tear Sheet</button>
      </div>
      <section class="bank-section bank-coverage-section">
        <div class="bank-section-title">Coverage Details & Notes</div>
        <div class="bank-coverage-grid">
          <label>
            <span>Status</span>
            <select id="bankCoverageStatus">${coverageSelectOptions(BANK_COVERAGE_STATUSES, status)}</select>
          </label>
          <label>
            <span>Priority</span>
            <select id="bankCoveragePriority">${coverageSelectOptions(BANK_COVERAGE_PRIORITIES, priority)}</select>
          </label>
          <label>
            <span>Owner</span>
            <input type="text" id="bankCoverageOwner" value="${escapeHtml(saved.owner || '')}" placeholder="Coverage owner">
          </label>
          <label>
            <span>Next Action</span>
            <input type="date" id="bankCoverageNextAction" value="${escapeHtml(saved.nextActionDate || '')}">
          </label>
        </div>
        <div class="bank-coverage-actions">
          <button type="button" class="small-btn" id="bankCoverageSaveBtn">Save Coverage</button>
          <button type="button" class="text-btn danger" id="bankCoverageRemoveBtn"${saved.bankId ? '' : ' hidden'}>Remove Saved Bank</button>
          <span class="bank-coverage-status" id="bankCoverageStatusText">${saved.bankId ? `Saved ${escapeHtml(formatFullTimestamp(saved.updatedAt))}` : 'Not saved yet'}</span>
        </div>
        <div class="bank-note-composer">
          <textarea id="bankNoteText" rows="3" placeholder="Add meeting notes, CD appetite, liquidity needs, objections, or follow-up items"></textarea>
          <button type="button" class="small-btn" id="bankNoteAddBtn">Add Note</button>
        </div>
        <div class="bank-notes-list" id="bankNotesList">
          <div class="bank-search-empty">Loading notes...</div>
        </div>
      </section>
      ${renderBankStrategyHistoryPanel('bankCoverageStrategyHistoryList')}
    `;
  }

  function renderCoverageDetail() {
    const detail = document.getElementById('bankCoverageDetail');
    if (!detail) return;
    if (!selectedBankCoverage || !selectedBankCoverage.bankId) {
      renderCoverageDetailEmpty();
      return;
    }
    detail.innerHTML = renderBankCoverageSection();
    wireBankCoverageControls();
    renderBankNotes();
    updateCoveragePanel();
    loadBankStrategyHistory(selectedBankCoverage.bankId);
  }

  function wireBankCoverageControls() {
    const saveCoverageBtn = document.getElementById('bankCoverageSaveBtn');
    const removeCoverageBtn = document.getElementById('bankCoverageRemoveBtn');
    const addNoteBtn = document.getElementById('bankNoteAddBtn');
    const openTearSheetBtn = document.getElementById('bankCoverageOpenTearSheetBtn');
    if (saveCoverageBtn) saveCoverageBtn.addEventListener('click', saveCurrentBankCoverage);
    if (removeCoverageBtn) removeCoverageBtn.addEventListener('click', removeCurrentBankCoverage);
    if (addNoteBtn) addNoteBtn.addEventListener('click', addCurrentBankNote);
    if (openTearSheetBtn) openTearSheetBtn.addEventListener('click', () => {
      if (!activeCoverageBankId) return;
      switchBankWorkspace('tear-sheet');
      loadBank(activeCoverageBankId, { collapseResults: true });
    });
  }

  function bankCoverageFormValues() {
    const isCoverageWorkspace = activeBankWorkspaceView === 'coverage';
    const tearSheetSaved = selectedTearSheetCoverage || getSavedBankById(selectedBankId()) || {};
    const tearSheetStatus = document.getElementById('bankTearSheetStatus')?.value || currentBankAccountStatus().status || 'Open';
    return {
      bankId: isCoverageWorkspace ? activeCoverageBankId : selectedBankId(),
      status: isCoverageWorkspace ? (document.getElementById('bankCoverageStatus')?.value || 'Open') : tearSheetStatus,
      priority: isCoverageWorkspace ? (document.getElementById('bankCoveragePriority')?.value || 'Medium') : (tearSheetSaved.priority || 'Medium'),
      owner: isCoverageWorkspace ? (document.getElementById('bankCoverageOwner')?.value || '') : (tearSheetSaved.owner || ''),
      nextActionDate: isCoverageWorkspace ? (document.getElementById('bankCoverageNextAction')?.value || '') : (tearSheetSaved.nextActionDate || '')
    };
  }

  function updateBankSaveButton() {
    const btn = document.getElementById('bankSaveBtn');
    const statusSelect = document.getElementById('bankTearSheetStatus');
    const ownerInput = document.getElementById('bankTearSheetOwner');
    if (btn) btn.textContent = selectedTearSheetCoverage && selectedTearSheetCoverage.bankId ? 'Saved' : 'Save Bank';
    if (statusSelect) statusSelect.value = currentBankAccountStatus().status || 'Open';
    if (ownerInput) ownerInput.value = currentBankAccountStatus().owner || '';
    updateTearSheetCoverageSignal();
  }

  function updateCoveragePanel() {
    const saved = selectedBankCoverage || {};
    const statusEl = document.getElementById('bankCoverageStatus');
    const priorityEl = document.getElementById('bankCoveragePriority');
    const ownerEl = document.getElementById('bankCoverageOwner');
    const nextActionEl = document.getElementById('bankCoverageNextAction');
    const removeBtn = document.getElementById('bankCoverageRemoveBtn');
    const statusText = document.getElementById('bankCoverageStatusText');
    if (statusEl) statusEl.value = saved.status || selectedBankAccountStatus?.status || 'Open';
    if (priorityEl) priorityEl.value = saved.priority || 'Medium';
    if (ownerEl) ownerEl.value = saved.owner || '';
    if (nextActionEl) nextActionEl.value = saved.nextActionDate || '';
    if (removeBtn) removeBtn.hidden = !saved.bankId;
    if (statusText) statusText.textContent = saved.bankId ? `Saved ${formatFullTimestamp(saved.updatedAt)}` : 'Not saved yet';
    updateBankSaveButton();
  }

  async function loadTearSheetCoverage(bankId) {
    const requestId = ++tearSheetCoverageRequestId;
    try {
      const res = await fetch(`/api/bank-coverage/${encodeURIComponent(bankId)}`, { cache: 'no-store' });
      const data = await readBankJson(res);
      if (requestId !== tearSheetCoverageRequestId || String(selectedBankId()) !== String(bankId)) return;
      selectedBankAccountStatus = data.accountStatus || selectedBankAccountStatus || defaultBankAccountStatus();
      selectedTearSheetCoverage = data.saved || getSavedBankById(bankId);
      if (selectedBank && selectedBank.bank) selectedBank.bank.peerPreference = data.peerPreference || null;
      selectedBankContacts = Array.isArray(data.contacts) ? data.contacts : [];
      selectedBankProductFit = Array.isArray(data.productFit) ? data.productFit : [];
      if (Array.isArray(data.productCatalog) && data.productCatalog.length) bankProductCatalog = data.productCatalog;
    } catch (e) {
      if (requestId !== tearSheetCoverageRequestId || String(selectedBankId()) !== String(bankId)) return;
      selectedTearSheetCoverage = getSavedBankById(bankId);
      selectedBankContacts = [];
      selectedBankProductFit = [];
      showToast("Couldn't load this bank's coverage details — showing saved data only.", true);
    }
    updateBankSaveButton();
    refreshBankContactsPanel();
    refreshBankProductFitPanel();
  }

  async function loadBankCoverage(bankId, options = {}) {
    try {
      const res = await fetch(`/api/bank-coverage/${encodeURIComponent(bankId)}`, { cache: 'no-store' });
      const data = await readBankJson(res);
      if (data.accountStatus) selectedBankAccountStatus = data.accountStatus;
      selectedBankCoverage = data.saved || getSavedBankById(bankId);
      if (selectedBank && selectedBank.bank && String(selectedBank.bank.id) === String(bankId)) {
        selectedBank.bank.peerPreference = data.peerPreference || null;
      }
      selectedBankNotes = Array.isArray(data.notes) ? data.notes : [];
      selectedBankContacts = Array.isArray(data.contacts) ? data.contacts : [];
      if (options.renderDetail) renderCoverageDetail();
      else {
        updateCoveragePanel();
        renderBankNotes();
      }
      refreshBankContactsPanel();
    } catch (e) {
      selectedBankCoverage = getSavedBankById(bankId);
      selectedBankNotes = [];
      selectedBankContacts = [];
      if (options.renderDetail) renderCoverageDetail();
      else {
        updateCoveragePanel();
        renderBankNotes(e.message);
      }
      refreshBankContactsPanel();
    }
  }

  async function saveCurrentBankCoverage() {
    const formValues = bankCoverageFormValues();
    if (!formValues.bankId) return showToast('No bank selected', true);
    try {
      const res = await fetch('/api/bank-coverage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formValues)
      });
      const data = await readBankJson(res);
      if (data.accountStatus) selectedBankAccountStatus = data.accountStatus;
      if (selectedBank && selectedBank.bank && selectedBank.bank.summary) {
        selectedBank.bank.summary.accountStatus = selectedBankAccountStatus;
      }
      if (activeBankWorkspaceView === 'coverage') {
        selectedBankCoverage = data.saved;
        activeCoverageBankId = data.saved.bankId;
        if (selectedBankId() === data.saved.bankId) selectedTearSheetCoverage = data.saved;
      } else {
        selectedTearSheetCoverage = data.saved;
      }
      await loadSavedBanks();
      if (activeBankWorkspaceView === 'coverage') renderCoverageDetail();
      else updateCoveragePanel();
      if (selectedBankId()) loadBankActivity(selectedBankId());
      showToast('Saved bank coverage');
    } catch (e) {
      showToast(e.message, true);
    }
  }

  async function saveCurrentBankAccountStatus() {
    const bankId = selectedBankId();
    const status = document.getElementById('bankTearSheetStatus')?.value || currentBankAccountStatus().status || 'Open';
    const owner = document.getElementById('bankTearSheetOwner')?.value || '';
    if (!bankId) return showToast('No bank selected', true);
    try {
      const res = await fetch('/api/bank-account-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankId, status, owner })
      });
      const data = await readBankJson(res);
      selectedBankAccountStatus = data.accountStatus || { status };
      if (data.saved) selectedTearSheetCoverage = data.saved;
      if (selectedBank && selectedBank.bank && selectedBank.bank.summary) {
        selectedBank.bank.summary.accountStatus = selectedBankAccountStatus;
      }
      await loadSavedBanks();
      updateBankSaveButton();
      if (selectedBankId()) loadBankActivity(selectedBankId());
      showToast('Saved bank status / owner');
    } catch (e) {
      showToast(e.message, true);
    }
  }

  async function removeCurrentBankCoverage() {
    const bankId = activeCoverageBankId || selectedBankId();
    if (!bankId) return showToast('No bank selected', true);
    if (!confirm('Remove this bank and its notes from the saved coverage list?')) return;
    try {
      const res = await fetch(`/api/bank-coverage/${encodeURIComponent(bankId)}`, { method: 'DELETE' });
      await readBankJson(res);
      selectedBankCoverage = null;
      selectedBankNotes = [];
      if (selectedTearSheetCoverage && selectedTearSheetCoverage.bankId === bankId) selectedTearSheetCoverage = null;
      if (activeCoverageBankId === bankId) activeCoverageBankId = null;
      await loadSavedBanks();
      if (activeBankWorkspaceView === 'coverage') renderCoverageDetailEmpty();
      else {
        updateCoveragePanel();
        renderBankNotes();
      }
      showToast('Removed saved bank');
    } catch (e) {
      showToast(e.message, true);
    }
  }

  async function addCurrentBankNote() {
    const bankId = activeCoverageBankId || selectedBankId();
    const textarea = document.getElementById('bankNoteText');
    const text = textarea ? textarea.value.trim() : '';
    if (!bankId) return showToast('No bank selected', true);
    if (!text) return showToast('Add note text first', true);
    try {
      const res = await fetch(`/api/bank-coverage/${encodeURIComponent(bankId)}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, coverage: bankCoverageFormValues() })
      });
      await readBankJson(res);
      if (textarea) textarea.value = '';
      await loadSavedBanks();
      await loadBankCoverage(bankId, { renderDetail: activeBankWorkspaceView === 'coverage' });
      if (selectedBankId() === bankId) loadBankActivity(bankId);
      showToast('Added bank note');
    } catch (e) {
      showToast(e.message, true);
    }
  }

  async function deleteBankNote(noteId) {
    if (!noteId) return;
    if (!confirm('Delete this note?')) return;
    try {
      const res = await fetch(`/api/bank-coverage/notes/${encodeURIComponent(noteId)}`, { method: 'DELETE' });
      await readBankJson(res);
      selectedBankNotes = selectedBankNotes.filter(note => note.id !== noteId);
      renderBankNotes();
      showToast('Deleted bank note');
    } catch (e) {
      showToast(e.message, true);
    }
  }

  function renderBankNotes(errorMessage) {
    const list = document.getElementById('bankNotesList');
    if (!list) return;
    if (errorMessage) {
      list.innerHTML = `<div class="bank-search-empty">${escapeHtml(errorMessage)}</div>`;
      return;
    }
    if (!selectedBankNotes.length) {
      list.innerHTML = '<div class="bank-search-empty">No notes yet.</div>';
      return;
    }
    list.innerHTML = selectedBankNotes.map(note => `
      <article class="bank-note">
        <div>
          <time>${escapeHtml(formatFullTimestamp(note.createdAt))}</time>
          <p>${escapeHtml(note.text).replace(/\n/g, '<br>')}</p>
        </div>
        <button type="button" class="text-btn danger" data-note-id="${escapeHtml(note.id)}">Delete</button>
      </article>
    `).join('');
    list.querySelectorAll('[data-note-id]').forEach(btn => {
      btn.addEventListener('click', () => deleteBankNote(btn.dataset.noteId));
    });
  }

  // ============ Bank Contacts (tear sheet) ============

  function renderBankContactsPanel() {
    const contacts = selectedBankContacts || [];
    const rowsHtml = contacts.length
      ? contacts.map(renderBankContactRow).join('')
      : '<li class="bank-contact-empty">No contacts on file. Add the bank&rsquo;s CFO, treasurer, or relationship manager.</li>';
    const formHtml = bankContactsAdding
      ? renderBankContactForm(null, { mode: 'add' })
      : `<button type="button" class="small-btn" id="bankContactAddBtn">+ Add contact</button>`;
    return `
      <section class="bank-section bank-contacts-section" id="bankContactsPanel">
        <div class="bank-section-title">Contacts</div>
        <ul class="bank-contacts-list" id="bankContactsList">${rowsHtml}</ul>
        <div class="bank-contacts-toolbar">${formHtml}</div>
      </section>
    `;
  }

  function renderBankContactRow(contact) {
    if (bankContactsEditingId === contact.id) {
      return `<li class="bank-contact-row is-editing" data-contact-row="${escapeHtml(contact.id)}">${renderBankContactForm(contact, { mode: 'edit' })}</li>`;
    }
    const phone = contact.phone ? `<a class="bank-contact-link" href="tel:${escapeHtml(phoneToTelHref(contact.phone))}">${escapeHtml(contact.phone)}</a>` : '';
    const email = contact.email ? `<a class="bank-contact-link" href="mailto:${escapeHtml(contact.email)}">${escapeHtml(contact.email)}</a>` : '';
    const roleLine = contact.role || '';
    const primaryBadge = contact.isPrimary ? '<span class="bank-contact-badge">Primary</span>' : '';
    const meta = [phone, email].filter(Boolean).join(' &middot; ');
    return `
      <li class="bank-contact-row" data-contact-row="${escapeHtml(contact.id)}">
        <div class="bank-contact-main">
          <p class="bank-contact-name">${escapeHtml(contact.name)} ${primaryBadge}</p>
          ${roleLine ? `<p class="bank-contact-role">${escapeHtml(roleLine)}</p>` : ''}
          ${meta ? `<p class="bank-contact-meta">${meta}</p>` : ''}
          ${contact.notes ? `<p class="bank-contact-notes">${escapeHtml(contact.notes).replace(/\n/g, '<br>')}</p>` : ''}
        </div>
        <div class="bank-contact-actions">
          <button type="button" class="text-btn" data-contact-edit="${escapeHtml(contact.id)}">Edit</button>
          <button type="button" class="text-btn danger" data-contact-delete="${escapeHtml(contact.id)}">Delete</button>
        </div>
      </li>
    `;
  }

  function renderBankContactForm(contact, { mode } = { mode: 'add' }) {
    const c = contact || { name: '', role: '', phone: '', email: '', isPrimary: false, notes: '' };
    const submitLabel = mode === 'edit' ? 'Save' : 'Add Contact';
    const idAttr = contact ? ` data-contact-form-id="${escapeHtml(contact.id)}"` : '';
    return `
      <form class="bank-contact-form" data-contact-form-mode="${escapeHtml(mode)}"${idAttr}>
        <div class="bank-contact-form-row">
          <label>
            <span>Name</span>
            <input type="text" name="name" required maxlength="200" value="${escapeHtml(c.name || '')}" placeholder="Full name">
          </label>
          <label>
            <span>Role</span>
            <input type="text" name="role" maxlength="120" value="${escapeHtml(c.role || '')}" placeholder="CFO, Treasurer, etc.">
          </label>
        </div>
        <div class="bank-contact-form-row">
          <label>
            <span>Phone</span>
            <input type="tel" name="phone" maxlength="40" value="${escapeHtml(c.phone || '')}" placeholder="(555) 123-4567">
          </label>
          <label>
            <span>Email</span>
            <input type="email" name="email" maxlength="180" value="${escapeHtml(c.email || '')}" placeholder="name@bank.com">
          </label>
        </div>
        <label class="bank-contact-form-full">
          <span>Notes</span>
          <textarea name="notes" rows="2" maxlength="2000" placeholder="Optional context, preferences, follow-up">${escapeHtml(c.notes || '')}</textarea>
        </label>
        <label class="bank-contact-form-checkbox">
          <input type="checkbox" name="isPrimary" ${c.isPrimary ? 'checked' : ''}>
          <span>Primary contact for this bank</span>
        </label>
        <div class="bank-contact-form-actions">
          <button type="submit" class="small-btn">${escapeHtml(submitLabel)}</button>
          <button type="button" class="text-btn" data-contact-cancel>Cancel</button>
        </div>
      </form>
    `;
  }

  function phoneToTelHref(phone) {
    return String(phone || '').replace(/[^\d+,;*#x]/gi, '');
  }

  function refreshBankContactsPanel() {
    const panel = document.getElementById('bankContactsPanel');
    if (!panel) return;
    panel.outerHTML = renderBankContactsPanel();
    wireBankContactsControls();
  }

  function wireBankContactsControls() {
    const panel = document.getElementById('bankContactsPanel');
    if (!panel) return;

    const addBtn = panel.querySelector('#bankContactAddBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        bankContactsAdding = true;
        bankContactsEditingId = null;
        refreshBankContactsPanel();
        const firstInput = document.querySelector('#bankContactsPanel input[name="name"]');
        if (firstInput) firstInput.focus();
      });
    }

    panel.querySelectorAll('[data-contact-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        bankContactsEditingId = btn.getAttribute('data-contact-edit');
        bankContactsAdding = false;
        refreshBankContactsPanel();
      });
    });

    panel.querySelectorAll('[data-contact-delete]').forEach(btn => {
      btn.addEventListener('click', () => deleteBankContactById(btn.getAttribute('data-contact-delete')));
    });

    panel.querySelectorAll('[data-contact-cancel]').forEach(btn => {
      btn.addEventListener('click', () => {
        bankContactsAdding = false;
        bankContactsEditingId = null;
        refreshBankContactsPanel();
      });
    });

    panel.querySelectorAll('form[data-contact-form-mode]').forEach(form => {
      form.addEventListener('submit', evt => {
        evt.preventDefault();
        submitBankContactForm(form);
      });
    });
  }

  function bankContactFormValues(form) {
    const fd = new FormData(form);
    return {
      name: String(fd.get('name') || '').trim(),
      role: String(fd.get('role') || '').trim(),
      phone: String(fd.get('phone') || '').trim(),
      email: String(fd.get('email') || '').trim(),
      notes: String(fd.get('notes') || '').trim(),
      isPrimary: fd.get('isPrimary') === 'on'
    };
  }

  async function submitBankContactForm(form) {
    const mode = form.getAttribute('data-contact-form-mode');
    const values = bankContactFormValues(form);
    if (!values.name) {
      showToast('Contact name is required', true);
      return;
    }
    if (mode === 'edit') {
      const id = form.getAttribute('data-contact-form-id');
      await updateBankContactById(id, values);
    } else {
      await createBankContactForCurrentBank(values);
    }
  }

  async function createBankContactForCurrentBank(values) {
    const bankId = selectedBankId();
    if (!bankId) return showToast('No bank loaded', true);
    try {
      const res = await fetch(`/api/banks/${encodeURIComponent(bankId)}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
      });
      const data = await readBankJson(res);
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      bankContactsAdding = false;
      await reloadBankContacts(bankId);
      showToast('Contact saved');
    } catch (e) {
      showToast(e.message || 'Could not save contact', true);
    }
  }

  async function updateBankContactById(contactId, values) {
    if (!contactId) return;
    try {
      const res = await fetch(`/api/bank-contacts/${encodeURIComponent(contactId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
      });
      const data = await readBankJson(res);
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      bankContactsEditingId = null;
      await reloadBankContacts(selectedBankId());
      showToast('Contact updated');
    } catch (e) {
      showToast(e.message || 'Could not update contact', true);
    }
  }

  async function deleteBankContactById(contactId) {
    if (!contactId) return;
    if (!window.confirm('Delete this contact?')) return;
    try {
      const res = await fetch(`/api/bank-contacts/${encodeURIComponent(contactId)}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await readBankJson(res);
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      await reloadBankContacts(selectedBankId());
      showToast('Contact deleted');
    } catch (e) {
      showToast(e.message || 'Could not delete contact', true);
    }
  }

  // ============ Bank Product Fit (tear sheet) ============

  function renderBankProductFitPanel() {
    const enabled = new Set((selectedBankProductFit || []).map(f => f.product));
    const catalog = bankProductCatalog && bankProductCatalog.length
      ? bankProductCatalog
      : ['CD Funding', 'Muni Credit / BCIS', 'ALM / IRR', 'Bond Swap', 'Portfolio Accounting', 'CECL Analysis'];
    const chips = catalog.map(product => {
      const flag = (selectedBankProductFit || []).find(f => f.product === product);
      const isOn = enabled.has(product);
      const flaggedBy = flag && flag.flaggedByDisplay ? `Flagged by ${flag.flaggedByDisplay}` : '';
      return `
        <button type="button"
                class="bank-product-chip${isOn ? ' is-on' : ''}"
                data-product-chip="${escapeHtml(product)}"
                ${flag ? `data-product-fit-id="${escapeHtml(flag.id)}"` : ''}
                title="${escapeHtml(flaggedBy)}">
          <span class="bank-product-chip-mark">${isOn ? '✓' : '+'}</span>
          <span class="bank-product-chip-label">${escapeHtml(product)}</span>
        </button>
      `;
    }).join('');
    return `
      <details class="bank-section bank-product-fit-section bank-product-fit-details" id="bankProductFitPanel">
        <summary class="bank-section-title">
          <span>Product Fit</span>
          <em>Open / close</em>
        </summary>
        <div class="bank-product-fit-strip">${chips}</div>
      </details>
    `;
  }

  function refreshBankProductFitPanel() {
    const panel = document.getElementById('bankProductFitPanel');
    if (!panel) return;
    panel.outerHTML = renderBankProductFitPanel();
    wireBankProductFitControls();
  }

  function wireBankProductFitControls() {
    const panel = document.getElementById('bankProductFitPanel');
    if (!panel) return;
    panel.querySelectorAll('[data-product-chip]').forEach(btn => {
      btn.addEventListener('click', () => toggleBankProductFit(
        btn.getAttribute('data-product-chip'),
        btn.getAttribute('data-product-fit-id')
      ));
    });
  }

  async function toggleBankProductFit(product, existingId) {
    const bankId = selectedBankId();
    if (!bankId || !product) return;
    try {
      if (existingId) {
        const res = await fetch(`/api/bank-product-fit/${encodeURIComponent(existingId)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
      } else {
        const res = await fetch(`/api/banks/${encodeURIComponent(bankId)}/product-fit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product })
        });
        if (!res.ok) {
          const data = await readBankJson(res);
          throw new Error(data.error || 'HTTP ' + res.status);
        }
      }
      await reloadBankProductFit(bankId);
      loadBankActivity(bankId);
    } catch (e) {
      showToast(e.message || 'Could not update product fit', true);
    }
  }

  async function reloadBankProductFit(bankId) {
    if (!bankId) {
      selectedBankProductFit = [];
      refreshBankProductFitPanel();
      return;
    }
    try {
      const res = await fetch(`/api/banks/${encodeURIComponent(bankId)}/product-fit`, { cache: 'no-store' });
      const data = await readBankJson(res);
      selectedBankProductFit = Array.isArray(data.productFit) ? data.productFit : [];
      if (Array.isArray(data.products) && data.products.length) bankProductCatalog = data.products;
    } catch (e) {
      selectedBankProductFit = [];
    }
    refreshBankProductFitPanel();
  }

  // ============ Bank Activity Timeline (tear sheet) ============

  const BANK_ACTIVITY_KIND_LABELS = {
    'coverage-save': 'Coverage',
    'coverage-update': 'Coverage',
    'coverage-remove': 'Coverage',
    'status-change': 'Status',
    'note': 'Note',
    'contact-add': 'Contact',
    'contact-update': 'Contact',
    'contact-delete': 'Contact',
    'strategy-create': 'Strategy',
    'strategy-update': 'Strategy',
    'strategy-delete': 'Strategy'
  };

  function bankActivityKindLabel(kind) {
    return BANK_ACTIVITY_KIND_LABELS[kind] || (kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : 'Activity');
  }

  function bankActivityKindClass(kind) {
    if (!kind) return '';
    if (kind.startsWith('contact')) return 'is-contact';
    if (kind.startsWith('strategy')) return 'is-strategy';
    if (kind.startsWith('coverage') || kind === 'status-change') return 'is-coverage';
    if (kind === 'note') return 'is-note';
    return '';
  }

  function renderBankActivityPanel({ open = false } = {}) {
    const items = selectedBankActivities || [];
    const rows = items.length
      ? items.map(renderBankActivityRow).join('')
      : '<li class="bank-activity-empty">No activity yet. Coverage changes, notes, contacts, and strategy requests show up here.</li>';
    return `
      <details class="bank-section bank-activity-section bank-activity-details" id="bankActivityPanel" ${open ? 'open' : ''}>
        <summary class="bank-section-title">
          <span>Activity Timeline</span>
          <em>Open / close</em>
        </summary>
        <ol class="bank-activity-list" id="bankActivityList">${rows}</ol>
      </details>
    `;
  }

  function renderBankActivityRow(item) {
    const actor = item.actorDisplay || item.actorUsername || 'Unknown';
    const when = item.at ? formatRelativeAt(item.at) : '';
    const tooltip = item.at ? formatFullTimestamp(item.at) : '';
    const deleteButton = item.id
      ? `<button type="button" class="text-btn danger bank-activity-delete-btn" data-activity-delete="${escapeHtml(item.id)}">Delete</button>`
      : '';
    return `
      <li class="bank-activity-item ${bankActivityKindClass(item.kind)}" data-activity-row="${escapeHtml(item.id || '')}">
        <span class="bank-activity-kind">${escapeHtml(bankActivityKindLabel(item.kind))}</span>
        <div class="bank-activity-body">
          <p class="bank-activity-summary">${escapeHtml(item.summary || bankActivityKindLabel(item.kind))}</p>
          <p class="bank-activity-meta">
            <span>${escapeHtml(actor)}</span>
            <span class="bank-activity-dot" aria-hidden="true">&middot;</span>
            <time datetime="${escapeHtml(item.at)}" title="${escapeHtml(tooltip)}">${escapeHtml(when)}</time>
          </p>
        </div>
        ${deleteButton}
      </li>
    `;
  }

  function refreshBankActivityPanel() {
    const panel = document.getElementById('bankActivityPanel');
    if (!panel) return;
    const wasOpen = panel.open;
    panel.outerHTML = renderBankActivityPanel({ open: wasOpen });
    wireBankActivityControls();
  }

  function wireBankActivityControls() {
    const panel = document.getElementById('bankActivityPanel');
    if (!panel) return;
    panel.querySelectorAll('[data-activity-delete]').forEach(btn => {
      btn.addEventListener('click', () => deleteBankActivityById(btn.getAttribute('data-activity-delete')));
    });
  }

  async function deleteBankActivityById(activityId) {
    const bankId = bankActivityBankId || selectedBankId();
    if (!bankId || !activityId) return;
    if (!window.confirm('Delete this timeline activity? This only removes the timeline entry.')) return;
    try {
      const res = await fetch(`/api/banks/${encodeURIComponent(bankId)}/activity/${encodeURIComponent(activityId)}`, { method: 'DELETE' });
      const data = await readBankJson(res);
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      selectedBankActivities = (selectedBankActivities || []).filter(item => item.id !== activityId);
      refreshBankActivityPanel();
      showToast('Deleted timeline activity');
    } catch (e) {
      showToast(e.message || 'Could not delete timeline activity', true);
    }
  }

  async function loadBankActivity(bankId) {
    if (!bankId) {
      selectedBankActivities = [];
      bankActivityBankId = null;
      refreshBankActivityPanel();
      return;
    }
    bankActivityBankId = bankId;
    const reqId = ++bankActivityRequestId;
    try {
      const res = await fetch(`/api/banks/${encodeURIComponent(bankId)}/activity?limit=50`, { cache: 'no-store' });
      const data = await readBankJson(res);
      if (reqId !== bankActivityRequestId) return;
      selectedBankActivities = Array.isArray(data.activities) ? data.activities : [];
    } catch (e) {
      if (reqId !== bankActivityRequestId) return;
      selectedBankActivities = [];
      showToast("Couldn't load this bank's activity timeline.", true);
    }
    refreshBankActivityPanel();
  }

  async function reloadBankContacts(bankId) {
    if (!bankId) {
      selectedBankContacts = [];
      refreshBankContactsPanel();
      return;
    }
    if (bankId) loadBankActivity(bankId);
    try {
      const res = await fetch(`/api/banks/${encodeURIComponent(bankId)}/contacts`, { cache: 'no-store' });
      const data = await readBankJson(res);
      selectedBankContacts = Array.isArray(data.contacts) ? data.contacts : [];
    } catch (e) {
      selectedBankContacts = [];
    }
    refreshBankContactsPanel();
  }

  function printBankProfile() {
    if (!selectedBank || !selectedBank.bank) return showToast('No bank tear sheet loaded', true);
    // The portfolio panel loads asynchronously; printing mid-load would capture
    // its placeholder. Let the rep wait or print anyway.
    if (bankIntelligenceLoading && !confirm('The portfolio panel is still loading — print anyway?')) return;
    window.print();
  }

  function exportBankProfileCsv() {
    if (!selectedBank || !selectedBank.bank) return showToast('No bank tear sheet loaded', true);
    const bank = selectedBank.bank;
    const meta = selectedBank.metadata || {};
    const fields = meta.fields || [];
    const latest = bank.periods && bank.periods[0] ? bank.periods[0] : { values: {} };
    const values = latest.values || {};
    const rows = [
      ['Section', 'Metric', 'Period', 'Value']
    ];

    const exportCounty = String(values.county || '').replace(/,.*$/, '').replace(/\s+county$/i, '').trim();
    const exportLocation = [values.city, values.state].filter(Boolean).join(', ');
    const detailRows = [
      ['Details', 'Account Name', latest.period || '', values.name || bank.summary.name || ''],
      ['Details', 'Phone', latest.period || '', values.phone || ''],
      ['Details', 'Website', latest.period || '', values.website || ''],
      ['Details', 'Location', latest.period || '', exportLocation],
      ['Details', 'County', latest.period || '', exportCounty],
      ['Details', 'Cert Number', latest.period || '', values.certNumber || ''],
      ['Details', 'Primary Regulator', latest.period || '', values.primaryRegulator || '']
    ];
    rows.push(...detailRows);

    fields
      .filter(field => field.section !== 'details' && Object.prototype.hasOwnProperty.call(values, field.key))
      .forEach(field => {
        rows.push([
          field.section,
          field.label,
          latest.period || '',
          formatBankValue(values[field.key], field.type)
        ]);
      });

    rows.push([]);
    rows.push(['Time Series', 'Metric', 'Period', 'Value']);
    const fieldByKey = Object.fromEntries(fields.map(field => [field.key, field]));
    [
      'totalAssets', 'totalDeposits', 'totalLoans', 'loansToAssets',
      'securitiesToAssets', 'roa', 'roe', 'netInterestMargin',
      'efficiencyRatio', 'texasRatio', 'liquidAssetsToAssets'
    ].forEach(key => {
      const field = fieldByKey[key];
      if (!field) return;
      (bank.periods || []).forEach(period => {
        rows.push([
          'Time Series',
          field.label,
          period.period || period.endDate || '',
          formatBankValue(period.values && period.values[key], field.type)
        ]);
      });
    });

    const filename = `fbbs_bank_tear_sheet_${slugifyFilename(bank.summary.displayName || bank.summary.name || bank.id)}_${latest.period || 'latest'}.csv`;
    downloadCsv(filename, rows);
    showToast('Exported bank tear sheet CSV');
  }

  function renderBankFieldSection(title, fields, values, section, denominatorKey) {
    const rows = fields
      .filter(field => field.section === section)
      .map(field => {
        const value = formatBankValue(values[field.key], field.type);
        const derivedPct = field.denominatorKey ? bankShare(values[field.key], values[field.denominatorKey]) : null;
        const pct = denominatorKey && field.key !== denominatorKey ? bankShare(values[field.key], values[denominatorKey]) : derivedPct;
        return [field.label, pct == null ? value : `${value} / ${pct}`];
      });
    return renderBankSection(title, rows);
  }

  function bankBalanceSheetRows() {
    return [
      { label: 'Total Assets ($000)', key: 'totalAssets', type: 'money', value: values => formatCallReportValue(values.totalAssets, 'money') },
      { label: 'Total Securities (AFS-FV) ($000/ %)', key: 'afsTotal', type: 'money', value: values => formatCallReportMoneyShare(values.afsTotal, values.afsTotal) },
      { label: 'Total Securities (HTM-FV) ($000/ %)', key: 'htmTotal', type: 'money', value: values => formatCallReportMoneyShare(values.htmTotal, values.htmTotal) },
      { label: 'Total Securities / Total Assets (%)', key: 'securitiesToAssets', type: 'percent', value: values => formatCallReportValue(values.securitiesToAssets, 'percent') },
      { label: 'Total Loans & Leases (HFI, HFS) ($000)', key: 'totalLoans', type: 'money', value: values => formatCallReportValue(values.totalLoans, 'money') },
      { label: 'Total Loans / Assets (%)', key: 'loansToAssets', type: 'percent', value: values => formatCallReportValue(values.loansToAssets, 'percent') },
      { label: 'Total Deposits ($000)', key: 'totalDeposits', type: 'money', value: values => formatCallReportValue(values.totalDeposits, 'money') },
      { label: 'Loans / Deposits (%)', key: 'loansToDeposits', type: 'percent', value: values => formatCallReportValue(values.loansToDeposits, 'percent') },
      { label: 'Have Fiduciary Assets? (Yes/No)', value: values => Number(values.fiduciaryAssets || 0) > 0 ? 'Yes' : 'No' },
      { label: 'Total Borrowings ($000)', key: 'totalBorrowings', type: 'money', value: values => formatCallReportValue(values.totalBorrowings, 'money') }
    ];
  }

  function bankSecuritiesRows() {
    return [
      { label: 'US Treasury Secs ($000/ %)', keys: ['afsTreasury', 'htmTreasury'] },
      { label: 'US Govt Ag & US Corp ($000/ %)', keys: ['afsAgencyCorp', 'htmAgencyCorp'] },
      { label: 'Munis ($000/ %)', keys: ['afsMunis', 'htmMunis'] },
      { label: 'Pass Thru RMBS: Total ($000/ %)', keys: ['afsPassThroughRmbs', 'htmPassThroughRmbs'] },
      { label: 'CMOs & Other RMBS ($000/ %)', keys: ['afsOtherRmbs', 'htmOtherRmbs'] },
      { label: 'CMBS ($000/ %)', keys: ['afsCmbs', 'htmCmbs'] },
      { label: 'Total All MBS ($000/ %)', keys: ['afsAllMbs', 'htmAllMbs'] },
      { label: 'Other Debt Secs ($000/ %)', keys: ['afsOtherDebt', 'htmOtherDebt'] }
    ].map(row => ({
      label: row.label,
      value: values => {
        const total = sumBankValues(values, ['afsTotal', 'htmTotal']);
        const amount = sumBankValues(values, row.keys);
        return formatCallReportMoneyShare(amount, total);
      }
    }));
  }

  function bankLoanCompositionRows() {
    return [
      { label: 'Real Estate Loans / Loans (%)', key: 'realEstateLoansToLoans' },
      { label: 'Farmland (*incl in RE) / Loans (%)', key: 'farmLoansToLoans' },
      { label: 'Agricultural Prod / Loans (%)', key: 'agProdLoansToLoans' },
      { label: 'Total C&I Loans / Loans (%)', key: 'ciLoansToLoans' },
      { label: 'Total Consumer Loans / Loans (%)', key: 'consumerLoansToLoans' }
    ].map(row => ({
      label: row.label,
      key: row.key,
      type: 'percent',
      value: values => formatCallReportValue(values[row.key], 'percent')
    }));
  }

  function bankCapitalRows() {
    return [
      { number: 31, label: 'Total Equity Capital ($000)', key: 'totalEquityCapital', type: 'money' },
      { number: 32, label: 'Tier 1 Capital ($000)', key: 'tier1Capital', type: 'money' },
      { number: 33, label: 'Tier 1 Risk-based Ratio (%)', key: 'tier1RiskBasedRatio', type: 'percent' },
      { number: 34, label: 'Risk Based Capital Ratio (%)', key: 'riskBasedCapitalRatio', type: 'percent' },
      { number: 35, label: 'Tang Equity / Tang Assets (%)', key: 'tangibleEquityToAssets', type: 'percent' },
      { number: 35, label: 'Leverage Ratio (%)', key: 'leverageRatio', type: 'percent' },
      { number: 36, label: 'Total Dividends Declared ($000)', key: 'dividendsDeclared', type: 'money' },
      { number: 37, label: 'Common Divis Declared / Net Inc (%)', key: 'dividendsToNetIncome', type: 'percent' }
    ].map(callReportFieldRow);
  }

  function bankProfitabilityRows() {
    return [
      { number: 38, label: 'ROA (%)', key: 'roa', type: 'percent' },
      { number: 39, label: 'ROE (%)', key: 'roe', type: 'percent' },
      { number: 40, label: 'Yield on Earning Assets (%)', key: 'yieldOnEarningAssets', type: 'percent' },
      { number: 41, label: 'Yield on Loans (%)', key: 'yieldOnLoans', type: 'percent' },
      { number: 42, label: 'Yield on Securities (Full Tax Equiv) (%)', key: 'yieldOnSecurities', type: 'percent' },
      { number: 43, label: 'Net Interest Margin (%)', key: 'netInterestMargin', type: 'percent' },
      { number: 44, label: 'Efficiency Ratio (FTE) (%)', key: 'efficiencyRatio', type: 'percent' },
      { number: 45, label: 'Cost of Funds (%)', key: 'costOfFunds', type: 'percent' },
      { number: 46, label: 'Net Income ($000)', key: 'netIncome', type: 'money' },
      {
        number: 55,
        label: 'Deposits / FTE ($000)',
        key: 'depositsPerFte',
        type: 'money',
        bankPeerValue: values => {
          const deposits = Number(values.totalDeposits);
          const fte = Number(values.fullTimeEmployees);
          return isFinite(deposits) && isFinite(fte) && fte !== 0 ? deposits / fte : null;
        },
        value: values => {
          const deposits = Number(values.totalDeposits);
          const fte = Number(values.fullTimeEmployees);
          return isFinite(deposits) && isFinite(fte) && fte !== 0
            ? formatCallReportValue(deposits / fte, 'money')
            : '-';
        }
      },
      { number: 56, label: 'Realized Gain/Loss on Securities ($000)', key: 'realizedGainLossSecurities', type: 'money' }
    ].map(row => row.value ? row : callReportFieldRow(row));
  }

  function bankAssetQualityRows() {
    return [
      { label: 'Texas Ratio (%)', key: 'texasRatio', type: 'percent' },
      { label: 'Loan Loss Reserves / Loans (%)', key: 'llrToLoans', type: 'percent' },
      { label: 'NPLs / Loans (%)', key: 'nplsToLoans', type: 'percent' },
      { label: 'Loan & Lease Loss Reserve ($000)', key: 'loanLossReserve', type: 'money' },
      { label: 'Provision for Loan & Lease Losses ($000)', key: 'loanLossProvision', type: 'money' },
      { label: 'Net Chargeoffs / Avg Loans (%)', key: 'netChargeoffsToAvgLoans', type: 'percent' }
    ].map(callReportFieldRow);
  }

  function bankLiquidityRows() {
    return [
      {
        number: 63,
        label: 'Total Dep with Bal > $250K / Deposits (%)',
        key: 'largeDepositsToDeposits',
        type: 'percent',
        bankPeerValue: values => bankNumericShare(values.largeDepositsToDeposits, values.totalDeposits),
        value: values => {
          const pct = bankNumericShare(values.largeDepositsToDeposits, values.totalDeposits);
          return pct == null ? '-' : formatCallReportValue(pct, 'percent');
        }
      },
      { number: 64, label: 'Non-Int Bearing Dep / Deposits (%)', key: 'nonInterestBearingDeposits', type: 'percent' },
      { number: 65, label: 'Brokered Deposits / Deposits (%)', key: 'brokeredDepositsToDeposits', type: 'percent' },
      { number: 66, label: 'Jumbo Time Dep / Dom Deposits (%)', key: 'jumboTimeDeposits', type: 'percent' },
      { number: 67, label: 'Public Funds / Dom Deposits (%)', key: 'publicFunds', type: 'percent' },
      { number: 68, label: 'Net NonCore Funding Dependence (%)', key: 'netNonCoreFundingDependence', type: 'percent' },
      { number: 69, label: 'Reliance on Wholesale Funding (%)', key: 'wholesaleFundingReliance', type: 'percent' },
      { number: 70, label: 'Long-term Assets / Assets (%)', key: 'longTermAssetsToAssets', type: 'percent' },
      { number: 71, label: 'Liquid Assets / Assets (%)', key: 'liquidAssetsToAssets', type: 'percent' },
      { number: 72, label: 'Avg Int Bear Funds / Avg Assets (%)', key: 'avgIntBearingFundsToAssets', type: 'percent' },
      { number: 73, label: 'Int Earn Assets / Int Bear Funds (%)', key: 'intEarnAssetsToFunds', type: 'percent' },
      {
        number: 74,
        label: 'Pledged Securities (BV) ($000/ %)',
        key: 'pledgedSecuritiesToSecurities',
        type: 'percent',
        bankPeerValue: values => bankNumericShare(values.pledgedSecurities, sumBankValues(values, ['afsTotal', 'htmTotal'])),
        value: values => formatCallReportMoneyShare(values.pledgedSecurities, sumBankValues(values, ['afsTotal', 'htmTotal']))
      },
      { number: 76, label: 'Securities (FV) / Securities (BV) (%)', key: 'securitiesFvToBv', type: 'percent' }
    ].map(row => row.value ? row : callReportFieldRow(row));
  }

  function callReportFieldRow(row) {
    return {
      number: row.number,
      label: row.label,
      key: row.key,
      type: row.type,
      value: values => formatCallReportValue(values[row.key], row.type)
    };
  }

  function renderBankPeerBanner(peerComparison) {
    if (!peerComparison || !peerComparison.peerGroup) {
      return `
        <div class="bank-peer-banner bank-peer-banner-empty">
          <strong>Peer comparison</strong>
          <span>Import an Averaged-Series workbook to show peer averages in the call-report sections.</span>
          <button type="button" class="text-btn" data-goto="reports">Open Reports workspace</button>
        </div>
      `;
    }
    const group = peerComparison.peerGroup;
    const criteria = group.criteria || {};
    // subchapterS may come pre-formatted ("Sub-S"/"C-corp" from custom
    // cohorts) or raw ("Yes"/"No" from the legacy FedFis workbook).
    const subSBit = criteria.subchapterS
      ? (/^(sub-?s|c-?corp)/i.test(criteria.subchapterS) ? criteria.subchapterS : `Sub-S ${criteria.subchapterS}`)
      : '';
    const bits = [
      criteria.assetRange,
      criteria.agLoanRange ? `Ag ${criteria.agLoanRange}` : '',
      subSBit,
      criteria.loanMix,
      criteria.region
    ].filter(Boolean).join(' · ');
    const populationText = group.populationCount ? `${formatNumber(group.populationCount)} banks` : '';
    const metricCount = peerComparison.byKey ? Object.keys(peerComparison.byKey).length : 0;
    const metricText = metricCount ? `${formatNumber(metricCount)} peer metrics` : '';
    const periodText = peerComparison.period || group.latestPeriod || '';
    const confidence = peerComparison.confidence || {};
    const confidenceLevel = confidence.level || 'Medium';
    const confidenceReason = Array.isArray(confidence.reasons) ? confidence.reasons.join(' · ') : '';
    const basis = Array.isArray(peerComparison.selectionBasis) && peerComparison.selectionBasis.length
      ? `Matched on ${peerComparison.selectionBasis.join(', ')}`
      : bits || 'Broad cohort';
    const reason = peerComparison.selectionReason || '';
    const mismatch = peerComparison.bankPeriod && peerComparison.period && peerComparison.bankPeriod !== peerComparison.period
      ? ` <em class="bank-peer-mismatch">Bank latest ${escapeHtml(peerComparison.bankPeriod)} · peer ${escapeHtml(periodText)}</em>`
      : '';
    return `
      <div class="bank-peer-banner">
        <strong>Peer cohort:</strong>
        <span>${escapeHtml(group.label || 'Averaged Series Peer Group')}${bits ? ` — ${escapeHtml(bits)}` : ''}</span>
        <span class="bank-peer-confidence bank-peer-confidence-${escapeHtml(confidenceLevel.toLowerCase())}" title="${escapeHtml(confidenceReason)}">${escapeHtml(confidenceLevel)} confidence</span>
        <span class="bank-peer-banner-meta">${escapeHtml([populationText, metricText, periodText].filter(Boolean).join(' · '))}${mismatch}</span>
        <span class="bank-peer-basis">${escapeHtml([reason, basis].filter(Boolean).join(': '))}</span>
        ${renderBankPeerCohortPicker(group)}
      </div>
    `;
  }

  // Per-tear-sheet cohort override. Loads the cohort list lazily on first
  // render, then refetches /api/banks/:id?cohortId=X to swap in a new
  // peerComparison and re-render the existing tear sheet. Picker selection
  // is in-memory (selectedBank.bank) — no persistence, by design: reps swap
  // cohorts to "what-if" without burning a coverage note.
  function renderBankPeerCohortPicker(currentGroup) {
    const list = peerGroupsState.cohorts || [];
    if (!list.length) return '';
    const preferredId = selectedBank && selectedBank.bank && selectedBank.bank.peerPreference
      ? String(selectedBank.bank.peerPreference.peerGroupId || '')
      : '';
    const currentId = currentGroup && currentGroup.id ? String(currentGroup.id) : '';
    const isPreferred = preferredId && currentId && preferredId === currentId;
    const opts = list
      .filter(c => !c.archivedAt)
      .map(c => `<option value="${escapeHtml(c.id)}"${currentGroup && c.id === currentGroup.id ? ' selected' : ''}>${escapeHtml(c.name)}</option>`)
      .join('');
    if (!opts) return '';
    return `
      <span class="bank-peer-cohort-pick">
        <label>Compare against
          <select data-cohort-picker>${opts}</select>
        </label>
        <button type="button" class="text-btn bank-peer-save-btn" data-save-peer-preference ${isPreferred ? 'disabled aria-disabled="true"' : ''}>${isPreferred ? 'Preferred' : 'Save as preferred'}</button>
      </span>`;
  }

  // Side effect: when the cohort picker fires, refetch the bank and replace
  // peerComparison in selectedBank so call-report sections re-render.
  async function handlePeerCohortChange(select) {
    const bankId = selectedBankId();
    if (!bankId) return;
    const cohortId = select.value;
    try {
      const res = await fetch(`/api/banks/${encodeURIComponent(bankId)}${cohortId ? '?cohortId=' + encodeURIComponent(cohortId) : ''}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Cohort switch failed');
      selectedBank = data;
      renderBankProfile();
    } catch (err) {
      showToast('Cohort switch failed: ' + (err.message || err), true);
    }
  }

  async function savePeerCohortPreference() {
    const bankId = selectedBankId();
    const peer = selectedBank && selectedBank.bank ? selectedBank.bank.peerComparison : null;
    const cohortId = peer && peer.peerGroup ? peer.peerGroup.id : '';
    if (!bankId || !cohortId) return showToast('No peer cohort selected', true);
    try {
      const res = await fetch(`/api/banks/${encodeURIComponent(bankId)}/peer-preference`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cohortId })
      });
      const data = await readBankJson(res);
      if (selectedBank && selectedBank.bank) {
        selectedBank.bank.peerPreference = data.peerPreference || { bankId, peerGroupId: cohortId };
        if (selectedBank.bank.peerComparison) {
          selectedBank.bank.peerComparison.selectionReason = 'Preferred cohort';
          selectedBank.bank.peerComparison.preferredPeerGroupId = cohortId;
        }
      }
      renderBankProfile();
      showToast('Saved preferred peer cohort');
    } catch (err) {
      showToast('Could not save preferred peer cohort: ' + (err.message || err), true);
    }
  }

  function renderBankCallReportSection(title, rows, periods, startNumber, peerComparison) {
    const visiblePeriods = (periods || []).slice(0, 8);
    if (!visiblePeriods.length) return '';
    const peerByKey = (peerComparison && peerComparison.byKey) || {};
    const hasPeer = Object.keys(peerByKey).length > 0;
    const sectionHasPeerRow = hasPeer && rows.some(row => row.key && peerByKey[row.key]);
    const columnStyle = `--period-count:${visiblePeriods.length};--peer-count:${sectionHasPeerRow ? 1 : 0};`;
    return `
      <section class="bank-section bank-call-report-section">
        <div class="bank-call-report-wrap">
          <table class="bank-call-report-table${sectionHasPeerRow ? ' has-peer-column' : ''}" style="${columnStyle}">
            <colgroup>
              <col class="bank-call-report-label-col">
              ${visiblePeriods.map(() => '<col class="bank-call-report-period-col">').join('')}
              ${sectionHasPeerRow ? '<col class="bank-call-report-peer-col">' : ''}
            </colgroup>
            <thead>
              <tr class="bank-call-report-header-row">
                <th class="bank-call-report-section-title">${escapeHtml(title)}</th>
                ${visiblePeriods.map(period => `<th>${escapeHtml(formatCallReportPeriod(period))}</th>`).join('')}
                ${sectionHasPeerRow ? `<th class="bank-peer-col" title="${escapeHtml(peerColumnTooltip(peerComparison))}">Peer Avg</th>` : ''}
              </tr>
            </thead>
            <tbody>
              ${rows.map((row, index) => `
                <tr>
                  <td><span>${row.number != null ? row.number : (startNumber || 1) + index}.</span> ${escapeHtml(row.label)}</td>
                  ${visiblePeriods.map(period => `<td>${escapeHtml(row.value((period && period.values) || {}))}</td>`).join('')}
                  ${sectionHasPeerRow ? renderPeerCell(row, peerByKey, visiblePeriods[0]) : ''}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderPeerCell(row, peerByKey, latestPeriod) {
    const peer = row.key ? peerByKey[row.key] : null;
    if (!peer || !Number.isFinite(Number(peer.peerValue))) {
      return '<td class="bank-peer-col bank-peer-cell-empty">—</td>';
    }
    const peerValue = Number(peer.peerValue);
    const peerDisplay = row.type === 'money'
      ? formatCallReportValue(peerValue, 'money')
      : row.type === 'percent'
        ? `${formatCallReportValue(peerValue, 'percent')}%`
        : formatCallReportNumber(peerValue, 2);
    const latestValues = latestPeriod && latestPeriod.values ? latestPeriod.values : {};
    const bankValueRaw = typeof row.bankPeerValue === 'function'
      ? row.bankPeerValue(latestValues)
      : latestValues[row.key];
    const bankValue = bankValueRaw == null || bankValueRaw === '' ? null : Number(bankValueRaw);
    let signal = 'neutral';
    let signalLabel = '';
    if (Number.isFinite(bankValue) && peer.higherIsBetter !== null && peer.higherIsBetter !== undefined) {
      const delta = bankValue - peerValue;
      if (Math.abs(delta) >= 0.01) {
        const favorable = peer.higherIsBetter ? delta > 0 : delta < 0;
        signal = favorable ? 'favorable' : 'watch';
        const arrow = delta > 0 ? '▲' : '▼';
        const deltaText = row.type === 'money'
          ? `${arrow} ${formatCallReportValue(Math.abs(delta), 'money')}`
          : `${arrow} ${formatCallReportNumber(Math.abs(delta), 2)}`;
        signalLabel = `<span class="bank-peer-delta">${escapeHtml(deltaText)}</span>`;
      }
    }
    const sampleSize = Number(peer.sampleSize);
    const sampleText = Number.isFinite(sampleSize) && sampleSize > 0 ? `n=${formatNumber(sampleSize)}` : '';
    const sampleLow = Number.isFinite(sampleSize) && sampleSize > 0 && sampleSize < 30;
    const titleParts = [
      peer.peerLabel,
      sampleText ? `Sample ${sampleText}` : '',
      sampleLow ? 'Low sample size' : ''
    ].filter(Boolean);
    const peerLabelAttr = titleParts.length ? ` title="${escapeHtml(titleParts.join(' · '))}"` : '';
    const sampleLabel = sampleLow ? `<span class="bank-peer-sample bank-peer-sample-low">${escapeHtml(sampleText)}</span>` : '';
    return `<td class="bank-peer-col bank-peer-signal-${signal}"${peerLabelAttr}><span class="bank-peer-value">${escapeHtml(peerDisplay)}</span>${signalLabel}${sampleLabel}</td>`;
  }

  function peerColumnTooltip(peerComparison) {
    if (!peerComparison) return '';
    const group = peerComparison.peerGroup || {};
    const criteria = group.criteria || {};
    const parts = [
      group.label,
      criteria.assetRange,
      criteria.region,
      peerComparison.selectionReason,
      Array.isArray(peerComparison.selectionBasis) && peerComparison.selectionBasis.length ? `Matched on ${peerComparison.selectionBasis.join(', ')}` : '',
      group.populationCount ? `${formatNumber(group.populationCount)} banks` : '',
      peerComparison.period ? `Peer period: ${peerComparison.period}` : ''
    ].filter(Boolean);
    return parts.join(' · ');
  }

  function formatCallReportPeriod(period) {
    return formatNumericDate(period && (period.endDate || period.period));
  }

  function formatCallReportValue(value, type) {
    if (value == null || value === '') return '-';
    const n = Number(value);
    if (!isFinite(n)) return String(value);
    if (type === 'money') return formatCallReportNumber(n, 0);
    if (type === 'percent') return formatCallReportNumber(n, 2);
    return String(value);
  }

  function formatCallReportNumber(value, digits) {
    const n = Number(value);
    if (!isFinite(n)) return '-';
    const formatted = Math.abs(n).toLocaleString('en-US', {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits
    });
    return n < 0 ? `(${formatted})` : formatted;
  }

  function sumBankValues(values, keys) {
    let total = 0;
    let hasValue = false;
    keys.forEach(key => {
      const value = Number(values[key]);
      if (isFinite(value)) {
        total += value;
        hasValue = true;
      }
    });
    return hasValue ? total : null;
  }

  function formatCallReportMoneyShare(value, total) {
    const amount = Number(value);
    const denominator = Number(total);
    if (!isFinite(amount) || amount === 0) return '- / -';
    const pct = isFinite(denominator) && denominator !== 0 ? `${((amount / denominator) * 100).toFixed(0)}%` : '-';
    return `${formatCallReportValue(amount, 'money')} / ${pct}`;
  }

  function bankNumericShare(value, total) {
    const n = Number(value);
    const d = Number(total);
    if (!isFinite(n) || !isFinite(d) || d === 0) return null;
    return (n / d) * 100;
  }

  function renderBankSection(title, rows, details) {
    const filtered = rows.filter(([, value]) => value !== null && value !== undefined && value !== '—' && value !== '');
    const midpoint = Math.ceil(filtered.length / 2);
    const columns = [filtered.slice(0, midpoint), filtered.slice(midpoint)];
    return `
      <section class="bank-section ${details ? 'details' : ''}">
        <div class="bank-section-title">${escapeHtml(title)}</div>
        <div class="bank-fields-grid">
          ${columns.map(col => `<div>${col.map(([label, value]) => `
            <div class="bank-field-row">
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(value)}</strong>
            </div>
          `).join('')}</div>`).join('')}
        </div>
      </section>
    `;
  }

  function formatBankValue(value, type) {
    if (value == null || value === '') return '—';
    if (type === 'money') return formatMoney(value, 0);
    if (type === 'percent') return formatPercentTile(value, 2);
    if (type === 'percentOf') return formatMoney(value, 0);
    if (type === 'number') return formatNumber(value);
    if (type === 'period') return String(value);
    return String(value);
  }

  function bankShare(value, total) {
    const n = Number(value);
    const d = Number(total);
    if (!isFinite(n) || !isFinite(d) || d === 0) return null;
    return formatPercentTile((n / d) * 100, 2);
  }

  function slotAcceptExtensions(slot) {
    if (slot === 'dashboard') return ['.html', '.htm'];
    if (slot === 'treasuryNotes') return ['.xlsx', '.xlsm', '.xls'];
    if (slot === 'cdoffers') return ['.pdf'];
    if (slot === 'cdoffersCost') return ['.xlsx', '.xlsm', '.xls'];
    if (slot === 'bairdSyndicate') return ['.xlsx', '.xlsm', '.xls'];
    if (slot === 'agenciesBullets' || slot === 'agenciesCallables' || slot === 'corporates') return ['.xlsx', '.xls'];
    return ['.pdf'];
  }

  function fileMatchesSlot(slot, filename) {
    const lower = filename.toLowerCase();
    return slotAcceptExtensions(slot).some(ext => lower.endsWith(ext));
  }

  function handleFileSelect(slot, file, zone) {
    if (!fileMatchesSlot(slot, file.name)) {
      const exts = slotAcceptExtensions(slot).join(' / ');
      showToast(`${DOC_TYPES[slot].label} slot expects ${exts}`, true);
      return;
    }
    const detected = classifyFile(file.name);
    const expectedSlot = slot === 'cdoffersCost' ? 'cdoffers' : slot;
    const genericGridForBaird = slot === 'bairdSyndicate' && /^grid\d*/i.test(file.name || '');
    if (detected && detected !== expectedSlot && !genericGridForBaird) {
      showToast(`Heads up: filename looks like a ${DOC_TYPES[detected].label} but you're putting it in the ${DOC_TYPES[slot].label} slot. Double-check before publishing.`, true);
    }

    selectedFiles[slot] = file;
    zone.classList.add('filled');
    const h5 = zone.querySelector('h5');
    const p = zone.querySelector('p');
    h5.textContent = 'File Selected';
    p.textContent = file.name;

    const statusEl = document.getElementById('status-' + slot);
    statusEl.innerHTML = `<span>${formatSize(file.size)}</span><span class="ok">Ready</span>`;
    updateUploadStat();
    renderUploadQaPreview();
  }

  function resetDropZone(slot) {
    const zone = document.querySelector(`.drop-zone[data-slot="${slot}"]`);
    if (!zone) return;
    zone.classList.remove('filled');
    const h5 = zone.querySelector('h5');
    const p = zone.querySelector('p');
    h5.textContent = h5.dataset.default || 'Drop File';
    p.textContent = p.dataset.default || 'or click to browse';
    const input = zone.querySelector('input');
    if (input) input.value = '';
    const statusEl = document.getElementById('status-' + slot);
    if (!statusEl) return;
    const accept = slotAcceptExtensions(slot).join(', ');
    const stateLabel = slot === 'cdoffersCost' ? 'Optional' : 'Awaiting';
    statusEl.innerHTML = `<span>Accepts: ${accept}</span><span class="pending">${stateLabel}</span>`;
    renderUploadQaPreview();
  }

  function updateUploadStat() {
    const count = Object.values(selectedFiles).filter(Boolean).length;
    const el = document.getElementById('uploadStat');
    if (!el) return;
    el.textContent = count
      ? `${count} selected`
      : packageCountText(currentPackage);
  }

  function selectedUploadEntries() {
    return Object.entries(selectedFiles).filter(([, file]) => file !== null);
  }

  function sniffDateFromFilename(filename) {
    const name = String(filename || '');
    const mdy = name.match(/(?:^|[^0-9])(\d{1,2})[._-](\d{1,2})[._-](\d{2,4})(?:[^0-9]|$)/);
    if (mdy) {
      let year = Number(mdy[3]);
      if (year < 100) year += 2000;
      const month = Number(mdy[1]);
      const day = Number(mdy[2]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
    const ymd = name.match(/(?:^|[^0-9])(\d{4})[._-](\d{1,2})[._-](\d{1,2})(?:[^0-9]|$)/);
    if (ymd) return `${ymd[1]}-${String(Number(ymd[2])).padStart(2, '0')}-${String(Number(ymd[3])).padStart(2, '0')}`;
    return '';
  }

  function renderUploadQaPreview() {
    const panel = document.getElementById('uploadQaPanel');
    const body = document.getElementById('uploadQaBody');
    const summary = document.getElementById('uploadQaSummary');
    if (!panel || !body || !summary) return;

    const entries = selectedUploadEntries();
    if (!entries.length) {
      panel.hidden = true;
      body.innerHTML = '';
      summary.textContent = '0 selected';
      return;
    }

    const selectedDates = entries
      .map(([, file]) => sniffDateFromFilename(file.name))
      .filter(Boolean);
    const uniqueDates = [...new Set(selectedDates)];
    const hasCdPdf = Boolean(selectedFiles.cdoffers);
    const hasCdCost = Boolean(selectedFiles.cdoffersCost);
    const warnings = [];
    if (uniqueDates.length > 1) warnings.push('Filename dates do not all match');
    if (hasCdCost && !hasCdPdf && !(currentPackage && currentPackage.cdoffers && !/\.(xlsx|xlsm|xls)$/i.test(currentPackage.cdoffers))) {
      warnings.push('Internal CD workbook selected without a CD PDF in this upload or current package');
    }

    panel.hidden = false;
    summary.textContent = warnings.length
      ? `${entries.length} selected · ${warnings.length} check${warnings.length === 1 ? '' : 's'}`
      : `${entries.length} selected · looks ready`;

    const rows = entries.map(([slot, file]) => {
      const detected = classifyFile(file.name);
      const expectedSlot = slot === 'cdoffersCost' ? 'cdoffers' : slot;
      const date = sniffDateFromFilename(file.name);
      const slotOk = !detected || detected === expectedSlot;
      const typeOk = fileMatchesSlot(slot, file.name);
      const rowTone = slotOk && typeOk ? 'ok' : 'warn';
      return `
        <div class="upload-qa-row ${rowTone}">
          <strong>${escapeHtml(DOC_TYPES[slot].label)}</strong>
          <span>${escapeHtml(file.name)}</span>
          <em>${escapeHtml(formatSize(file.size))}</em>
          <b>${escapeHtml(date ? formatShortDate(date) : 'No filename date')}</b>
          <small>${escapeHtml(slotOk ? 'Slot match' : `Looks like ${DOC_TYPES[detected]?.label || detected}`)}</small>
        </div>
      `;
    });

    const footer = warnings.length
      ? `<div class="upload-qa-warnings">${warnings.map(w => `<span>${escapeHtml(w)}</span>`).join('')}</div>`
      : '<div class="upload-qa-warnings ok"><span>Selected files are consistent enough to publish.</span></div>';
    body.innerHTML = rows.join('') + footer;
  }

  function todayIsoDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function folderDropSlotLabel(row) {
    if (!row) return 'File';
    if (row.label) return row.label;
    return row.slot && DOC_TYPES[row.slot] ? DOC_TYPES[row.slot].label : (row.reference ? 'Reference file' : 'Unclassified');
  }

  async function scanFolderDrop(options = {}) {
    const summary = document.getElementById('folderDropSummary');
    const grid = document.getElementById('folderDropGrid');
    const pathEl = document.getElementById('folderDropPath');
    const publishBtn = document.getElementById('folderDropPublishBtn');
    const scanBtn = document.getElementById('folderDropScanBtn');
    const date = todayIsoDate();
    if (scanBtn) scanBtn.disabled = true;
    if (summary && !options.silent) summary.textContent = 'Scanning folder...';
    try {
      const res = await fetch(`/api/folder-drop/scan?date=${encodeURIComponent(date)}`, { cache: 'no-store' });
      const data = await readBankJson(res);
      if (pathEl) pathEl.textContent = data.folderPath || '';
      renderFolderDropScan(data);
      if (!options.silent) showToast(`Scanned folder · ${formatNumber((data.publishable || []).length)} publishable file${(data.publishable || []).length === 1 ? '' : 's'}`);
    } catch (e) {
      if (summary) summary.textContent = e.message;
      if (grid) grid.innerHTML = '';
      if (publishBtn) publishBtn.disabled = true;
      if (!options.silent) showToast(e.message, true);
    } finally {
      if (scanBtn) scanBtn.disabled = false;
    }
  }

  function renderFolderDropScan(data) {
    const summary = document.getElementById('folderDropSummary');
    const grid = document.getElementById('folderDropGrid');
    const publishBtn = document.getElementById('folderDropPublishBtn');
    const publishable = Array.isArray(data.publishable) ? data.publishable : [];
    const references = Array.isArray(data.references) ? data.references : [];
    const ignored = Array.isArray(data.ignored) ? data.ignored : [];
    const warnings = Array.isArray(data.warnings) ? data.warnings : [];
    if (summary) {
      summary.innerHTML = `
        <strong>${escapeHtml(formatNumber(publishable.length))}</strong> publishable ·
        <strong>${escapeHtml(formatNumber(references.length))}</strong> reference/internal ·
        <strong>${escapeHtml(formatNumber(ignored.length))}</strong> ignored
        ${warnings.length ? `<span>${escapeHtml(warnings[0])}</span>` : '<span>Ready to publish after review.</span>'}
      `;
    }
    if (publishBtn) publishBtn.disabled = publishable.length === 0;
    if (!grid) return;
    const rows = [
      ...publishable.map(row => ({ ...row, tone: 'ok' })),
      ...references.map(row => ({ ...row, tone: 'ref' })),
      ...ignored.map(row => ({ ...row, tone: 'ignored' }))
    ];
    if (!rows.length) {
      grid.innerHTML = '<div class="bank-search-empty">Folder is empty. Copy today’s package files into the folder above, then scan again.</div>';
      return;
    }
    grid.innerHTML = `
      ${warnings.length ? `<div class="folder-drop-warnings">${warnings.map(w => `<span>${escapeHtml(w)}</span>`).join('')}</div>` : ''}
      <div class="folder-drop-list">
        ${rows.map(row => `
          <div class="folder-drop-file ${escapeHtml(row.tone)}">
            <div>
              <strong>${escapeHtml(row.filename)}</strong>
              <span>${escapeHtml(folderDropSlotLabel(row))}${row.date ? ` · ${escapeHtml(row.date)}` : ''}${row.companionRole && row.tone === 'ok' ? ' · companion' : ''}</span>
            </div>
            <em>${escapeHtml(formatFileSize(row.size || 0))}</em>
          </div>
        `).join('')}
      </div>
    `;
  }

  function resetSelectedUploadFiles() {
    selectedFiles = {
      dashboard: null, econ: null, relativeValue: null, mmd: null, treasuryNotes: null, cd: null, cdoffers: null, cdoffersCost: null, munioffers: null, bairdSyndicate: null,
      agenciesBullets: null, agenciesCallables: null, corporates: null
    };
    UPLOAD_SLOTS.forEach(resetDropZone);
    updateUploadStat();
    renderUploadQaPreview();
  }

  async function handlePublishedPackage(data) {
    const parts = [];
    if (typeof data.offeringsCount === 'number') parts.push(`${data.offeringsCount} CDs`);
    if (typeof data.treasuryNotesCount === 'number') parts.push(`${data.treasuryNotesCount} treasuries`);
    if (typeof data.mmdCurveCount === 'number') parts.push(`${data.mmdCurveCount} MMD points`);
    if (typeof data.muniOfferingsCount === 'number') parts.push(`${data.muniOfferingsCount} munis`);
    if (typeof data.agencyCount === 'number') parts.push(`${data.agencyCount} agencies`);
    if (typeof data.corporatesCount === 'number') parts.push(`${data.corporatesCount} corporates`);
    const extract = parts.length ? ` · ${parts.join(', ')} extracted` : '';
    showToast(`Published ${data.saved.length} file${data.saved.length === 1 ? '' : 's'}${extract}`);
    if (data.referenceIngest && !data.referenceIngest.error) {
      const refParts = [];
      const cdRows = data.referenceIngest.cdInternal && data.referenceIngest.cdInternal.uploadedOfferings;
      const snRows = data.referenceIngest.structuredNotes && data.referenceIngest.structuredNotes.uploadedNotes;
      const mcRows = data.referenceIngest.marketColor && data.referenceIngest.marketColor.uploadedItems;
      if (Array.isArray(cdRows) && cdRows.length) refParts.push(`${formatNumber(cdRows.length)} internal CDs`);
      if (Array.isArray(snRows) && snRows.length) refParts.push(`${formatNumber(snRows.length)} structured notes`);
      if (Array.isArray(mcRows) && mcRows.length) refParts.push(`${formatNumber(mcRows.length)} market emails`);
      if (refParts.length) setTimeout(() => showToast(`Reference files ingested · ${refParts.join(', ')}`), 500);
    }
    if (Array.isArray(data.dateWarnings) && data.dateWarnings.length) {
      setTimeout(() => showToast(data.dateWarnings[0], true), 600);
    }
    resetSelectedUploadFiles();
    await loadCurrent();
    await loadArchive();
    scanFolderDrop({ silent: true });
    setTimeout(() => goTo('home'), 500);
  }

  async function publishFolderDrop() {
    const btn = document.getElementById('folderDropPublishBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Publishing...';
    }
    try {
      const res = await fetch('/api/folder-drop/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: todayIsoDate() })
      });
      let data = {};
      try { data = await res.json(); } catch (_) {}
      if (res.ok && data.success) {
        await handlePublishedPackage(data);
      } else {
        showToast(data.error || `Folder publish failed (HTTP ${res.status})`, true);
      }
    } catch (e) {
      showToast('Folder publish failed: ' + e.message, true);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Publish Folder';
      }
    }
  }

  async function publishPackage() {
    const entries = selectedUploadEntries();
    if (entries.length === 0) {
      showToast('No files selected', true);
      return;
    }

    const btn = document.getElementById('publishBtn');
    btn.disabled = true;
    btn.textContent = 'Publishing…';

    const formData = new FormData();
    entries.forEach(([slot, file]) => {
      formData.append(slot, file, file.name);
    });

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      let data = {};
      try { data = await res.json(); } catch (_) {}

      if (res.ok && data.success) {
        await handlePublishedPackage(data);
      } else {
        showToast(data.error || `Upload failed (HTTP ${res.status})`, true);
      }
    } catch (e) {
      console.error(e);
      showToast('Upload failed: ' + e.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Publish Package';
    }
  }

  // ============ Weekly CD Recap ============

  async function loadCdRecap() {
    const body = document.getElementById('cdRecapBody');
    const stat = document.getElementById('cdRecapStat');
    const sub = document.getElementById('cdRecapSub');
    const kicker = document.getElementById('cdRecapKicker');
    const grid = document.getElementById('cdRecapStatusGrid');
    setCdRecapLoadingState();
    if (body) {
      body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:36px;color:var(--text3)">Loading weekly CD recap&hellip;</td></tr>';
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      let res;
      try {
        res = await fetch('/api/cd-recap/weekly', { cache: 'no-store', signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const recap = await res.json();
      cdRecapData = recap;

      if (stat) stat.textContent = formatNumber(recap.uniqueCusips || 0);
      if (sub) {
        sub.textContent = `${formatShortDate(recap.weekStart)} through ${formatShortDate(recap.weekEnd)} · ${formatNumber(recap.snapshotCount)} daily snapshot${recap.snapshotCount === 1 ? '' : 's'}`;
      }
      if (kicker) {
        kicker.textContent = `${formatNumber(recap.duplicateRowsRemoved || 0)} duplicate CUSIP row${recap.duplicateRowsRemoved === 1 ? '' : 's'} removed`;
      }
      if (grid) {
        const snapshotDates = Array.isArray(recap.snapshotDates) && recap.snapshotDates.length
          ? recap.snapshotDates.map(formatShortDate).join(', ')
          : 'No snapshots yet';
        const tiles = [
          { label: 'Week Range', value: `${formatShortDate(recap.weekStart)} - ${formatShortDate(recap.weekEnd)}` },
          { label: 'Daily Snapshots', value: formatNumber(recap.snapshotCount || 0) },
          { label: 'Raw Rows', value: formatNumber(recap.rawRows || 0) },
          { label: 'Unique CUSIP Count', value: formatNumber(recap.uniqueCusips || 0) },
          { label: 'Charted Term CUSIP Count', value: formatNumber(recap.recapTermUniqueCusips || 0) },
          { label: 'Last Refreshed', value: formatFullTimestamp(new Date().toISOString()) },
          { label: 'Snapshot Dates', value: snapshotDates }
        ];
        grid.innerHTML = tiles.map(t => `
          <div class="stat-tile">
            <span>${escapeHtml(t.label)}</span>
            <strong>${escapeHtml(String(t.value))}</strong>
          </div>
        `).join('');
      }
      renderCdRecapTable(recap);
      renderCdRecapCharts(recap);
    } catch (err) {
      console.error('Failed to load weekly CD recap:', err);
      cdRecapData = null;
      if (body) {
        body.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:36px;color:var(--danger)">
          Failed to load weekly CD recap: ${escapeHtml(err.message)}
        </td></tr>`;
      }
      renderCdRecapCharts(null);
      showToast('Could not load weekly CD recap: ' + err.message, true);
    }
  }

  function setCdRecapLoadingState() {
    const grid = document.getElementById('cdRecapStatusGrid');
    const termChart = document.getElementById('cdTermCountChart');
    const medianChart = document.getElementById('cdMedianRateChart');
    const medianLegend = document.getElementById('cdMedianRateLegend');
    const comparison = document.getElementById('cdRateComparisonTable');
    if (grid) grid.innerHTML = marketSkeletonCards(4);
    if (termChart) termChart.innerHTML = '<div class="chart-loading"><div class="loading-spinner" aria-hidden="true"></div><span>Loading issue counts&hellip;</span></div>';
    if (medianChart) medianChart.innerHTML = '<div class="chart-loading"><div class="loading-spinner" aria-hidden="true"></div><span>Loading rate comparison&hellip;</span></div>';
    if (medianLegend) medianLegend.innerHTML = '<span class="skeleton-pill"></span><span class="skeleton-pill"></span>';
    if (comparison) comparison.innerHTML = '<div class="table-loading"><div class="loading-spinner" aria-hidden="true"></div><span>Loading rate comparison table&hellip;</span></div>';
  }

  function renderCdRecapTable(recap) {
    const body = document.getElementById('cdRecapBody');
    if (!body) return;
    const terms = Array.isArray(recap.terms) ? recap.terms : [];
    if (!terms.length || !recap.snapshotCount) {
      body.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:36px;color:var(--text3)">
        Upload Daily CD Offers PDFs to build a weekly recap history.
      </td></tr>`;
      return;
    }
    body.innerHTML = terms.map(t => {
      const top = Array.isArray(t.top) && t.top.length
        ? t.top.map(o => `${escapeHtml(o.name || 'Issuer')} ${formatPercentTile(o.rate, 2)} ${escapeHtml(o.cusip || '')}`).join('<br>')
        : '<span style="color:var(--text3)">No issues</span>';
      return `
        <tr>
          <td><strong>${escapeHtml(t.label || t.term)}</strong></td>
          <td style="text-align:right">${formatNumber(t.uniqueCusips || 0)}</td>
          <td style="text-align:right">${t.issueShare == null ? '—' : (t.issueShare * 100).toFixed(0) + '%'}</td>
          <td class="rate-cell" style="text-align:right">${formatPercentTile(t.medianRate, 2)}</td>
          <td style="text-align:right">${formatPercentTile(t.minRate, 2)}</td>
          <td style="text-align:right">${formatPercentTile(t.maxRate, 2)}</td>
          <td>${top}</td>
        </tr>
      `;
    }).join('');
  }

  function renderCdRecapCharts(recap) {
    renderCdTermCountChart(recap);
    renderCdMedianRateChart(recap);
    renderCdRateComparisonTable(recap);
  }

  function renderCdTermCountChart(recap) {
    const chart = document.getElementById('cdTermCountChart');
    if (!chart) return;
    const terms = Array.isArray(recap && recap.terms)
      ? recap.terms
          .filter(t => Number(t.uniqueCusips) > 0)
          .sort((a, b) => Number(b.uniqueCusips || 0) - Number(a.uniqueCusips || 0))
          .slice(0, 8)
      : [];
    if (!terms.length) {
      chart.innerHTML = '<div class="chart-empty">Upload Daily CD Offers PDFs to build weekly term counts.</div>';
      return;
    }

    const maxCount = Math.max(...terms.map(t => Number(t.uniqueCusips || 0)), 1);
    chart.innerHTML = terms.map(t => {
      const count = Number(t.uniqueCusips || 0);
      const pct = Math.max(4, (count / maxCount) * 100);
      return `
        <div class="term-bar-row">
          <div class="term-bar-label">${escapeHtml(t.label || t.term)}</div>
          <div class="term-bar-track">
            <div class="term-bar-fill" style="width:${pct.toFixed(2)}%"></div>
          </div>
          <strong>${formatNumber(count)}</strong>
        </div>
      `;
    }).join('');
  }

  function renderCdMedianRateChart(recap) {
    const chart = document.getElementById('cdMedianRateChart');
    const legend = document.getElementById('cdMedianRateLegend');
    if (!chart) return;
    const comparison = recap && recap.rateComparisons;
    const periods = Array.isArray(comparison && comparison.periods) ? comparison.periods : [];
    const terms = Array.isArray(comparison && comparison.terms)
      ? comparison.terms.filter(row => Object.values(row.rates || {}).some(v => v != null && !isNaN(v)))
      : [];
    if (!periods.length || !terms.length) {
      if (legend) legend.innerHTML = '';
      chart.innerHTML = '<div class="chart-empty">Rate comparison will fill in as prior CD snapshots accumulate.</div>';
      return;
    }

    const comparisonPeriods = periods.filter(period => period.key !== 'today');
    const validPeriods = comparisonPeriods.filter(period =>
      terms.some(row => cdRateValue(row.rates && row.rates[period.key]) != null)
    );
    if (!validPeriods.length) {
      if (legend) legend.innerHTML = '';
      chart.innerHTML = '<div class="chart-empty">Rate comparison will fill in as prior CD snapshots accumulate.</div>';
      return;
    }
    if (!validPeriods.some(period => period.key === selectedCdRecapPeriod)) {
      selectedCdRecapPeriod = validPeriods[0].key;
    }

    const selectedPeriod = validPeriods.find(period => period.key === selectedCdRecapPeriod) || validPeriods[0];
    if (legend) {
      legend.innerHTML = `
        <div class="cd-period-toggle" role="group" aria-label="CD recap comparison period">
          <span>Compare today with</span>
          ${validPeriods.map(period => `
            <button type="button" class="${period.key === selectedPeriod.key ? 'active' : ''}" data-cd-recap-period="${escapeHtml(period.key)}">
              ${escapeHtml(period.label.replace('Previous ', ''))}
            </button>
          `).join('')}
        </div>
        <div class="cd-period-date">
          ${escapeHtml(selectedPeriod.label)}
          <em>${selectedPeriod.snapshotDate ? formatShortDate(selectedPeriod.snapshotDate) : 'No snapshot'}</em>
        </div>
      `;
      legend.querySelectorAll('[data-cd-recap-period]').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedCdRecapPeriod = btn.dataset.cdRecapPeriod;
          renderCdMedianRateChart(cdRecapData);
        });
      });
    }

    const rows = terms.map(row => {
      const today = cdRateValue(row.rates && row.rates.today);
      const periodRate = cdRateValue(row.rates && row.rates[selectedPeriod.key]);
      const prior = periodRate == null && today != null ? today : periodRate;
      const delta = today != null && prior != null ? today - prior : null;
      return {
        term: row.term,
        label: row.label || row.term,
        today,
        prior,
        delta
      };
    });
    const pairRates = rows.flatMap(row => [row.today, row.prior]).filter(Number.isFinite);
    const { min, max } = makeDumbbellRateDomain(Math.min(...pairRates), Math.max(...pairRates));
    const ticks = makeDumbbellRateTicks(min, max);

    chart.innerHTML = `
      <div class="cd-dumbbell-chart">
        <div class="cd-dumbbell-axis">
          ${ticks.map(tick => `
            <span style="left:${ratePosition(tick, min, max).toFixed(2)}%">${escapeHtml(formatPercentTile(tick, 2))}</span>
          `).join('')}
        </div>
        ${rows.map(row => renderDumbbellRow(row, min, max, selectedPeriod)).join('')}
      </div>
    `;
  }

  function renderDumbbellRow(row, min, max, selectedPeriod) {
    if (!Number.isFinite(row.today) || !Number.isFinite(row.prior)) {
      return `
        <div class="cd-dumbbell-row muted">
          <div class="cd-dumbbell-term">${escapeHtml(row.label)}</div>
          <div class="cd-dumbbell-track unavailable">No ${escapeHtml(selectedPeriod.label.toLowerCase())} rate</div>
          <div class="cd-dumbbell-delta">—</div>
        </div>
      `;
    }

    const priorPct = ratePosition(row.prior, min, max);
    const todayPct = ratePosition(row.today, min, max);
    const connectorLeft = Math.min(priorPct, todayPct);
    const connectorWidth = Math.abs(todayPct - priorPct);
    const direction = deltaClass(row.delta);
    const deltaText = formatBasisPointDelta(row.delta);
    return `
      <div class="cd-dumbbell-row" title="${escapeHtml(`${row.label}: ${formatPercentTile(row.prior, 2)} to ${formatPercentTile(row.today, 2)} (${deltaText})`)}">
        <div class="cd-dumbbell-term">${escapeHtml(row.label)}</div>
        <div class="cd-dumbbell-track">
          <span class="cd-dumbbell-connector ${direction}" style="left:${connectorLeft.toFixed(2)}%;width:${Math.max(1, connectorWidth).toFixed(2)}%"></span>
          <span class="cd-dumbbell-dot prior" style="left:${priorPct.toFixed(2)}%"></span>
          <span class="cd-dumbbell-dot today" style="left:${todayPct.toFixed(2)}%"></span>
        </div>
        <div class="cd-dumbbell-delta ${direction}">${escapeHtml(deltaText)}</div>
      </div>
    `;
  }

  function renderCdRateComparisonTable(recap) {
    const tableWrap = document.getElementById('cdRateComparisonTable');
    if (!tableWrap) return;
    const comparison = recap && recap.rateComparisons;
    const comparisonTerms = Array.isArray(comparison && comparison.terms) ? comparison.terms : [];
    const recapTerms = Array.isArray(recap && recap.terms) ? recap.terms : [];
    const issueByTerm = new Map(recapTerms.map(row => [row.term, row]));
    const rows = comparisonTerms
      .filter(row => Object.values(row.rates || {}).some(v => v != null && !isNaN(v)))
      .map(row => {
        const issue = issueByTerm.get(row.term) || {};
        return {
          term: row.term,
          label: row.label || row.term,
          count: Number(issue.uniqueCusips || 0),
          share: issue.issueShare,
          rates: row.rates || {},
          deltas: row.deltas || {}
        };
      });

    if (!rows.length) {
      tableWrap.innerHTML = '<div class="chart-empty">Rate comparison table will fill in as prior CD snapshots accumulate.</div>';
      return;
    }

    tableWrap.innerHTML = `
      <table class="rate-comparison-table">
        <thead>
          <tr>
            <th>Term</th>
            <th>Count</th>
            <th>Share</th>
            <th>Today</th>
            <th>Prev Week</th>
            <th>Wk Chg</th>
            <th>Prev Month</th>
            <th>Mo Chg</th>
            <th>Prev Year</th>
            <th>Yr Chg</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr>
              <td><strong>${escapeHtml(row.label)}</strong></td>
              <td>${escapeHtml(formatNumber(row.count))}</td>
              <td>${escapeHtml(formatIssueShare(row.share))}</td>
              <td>${escapeHtml(formatPercentTile(row.rates.today, 2))}</td>
              <td>${escapeHtml(formatPercentTile(row.rates.previousWeek, 2))}</td>
              <td><span class="rate-change-pill ${deltaClass(row.deltas.previousWeek)}">${escapeHtml(formatBasisPointDelta(row.deltas.previousWeek))}</span></td>
              <td>${escapeHtml(formatPercentTile(row.rates.previousMonth, 2))}</td>
              <td><span class="rate-change-pill ${deltaClass(row.deltas.previousMonth)}">${escapeHtml(formatBasisPointDelta(row.deltas.previousMonth))}</span></td>
              <td>${escapeHtml(formatPercentTile(row.rates.previousYear, 2))}</td>
              <td><span class="rate-change-pill ${deltaClass(row.deltas.previousYear)}">${escapeHtml(formatBasisPointDelta(row.deltas.previousYear))}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function makeDumbbellRateDomain(minRate, maxRate) {
    if (!Number.isFinite(minRate) || !Number.isFinite(maxRate)) {
      return { min: 3, max: 5 };
    }
    const range = maxRate - minRate;
    const padding = Math.max(0.12, range * 0.25);
    let min = Math.max(0, Math.floor((minRate - padding) * 4) / 4);
    let max = Math.ceil((maxRate + padding) * 4) / 4;
    if (max - min < 0.75) {
      const mid = (minRate + maxRate) / 2;
      min = Math.max(0, Math.floor((mid - 0.375) * 4) / 4);
      max = Math.ceil((mid + 0.375) * 4) / 4;
    }
    return { min, max };
  }

  function makeDumbbellRateTicks(min, max) {
    const steps = 4;
    const range = Math.max(0.01, max - min);
    return Array.from({ length: steps + 1 }, (_, index) => Number((min + (range / steps) * index).toFixed(2)));
  }

  function ratePosition(rate, min, max) {
    if (!Number.isFinite(rate) || max <= min) return 50;
    return Math.max(0, Math.min(100, ((rate - min) / (max - min)) * 100));
  }

  function formatBasisPointDelta(delta) {
    if (!Number.isFinite(delta)) return '—';
    if (Math.abs(delta) < 0.005) return 'No change';
    const bps = Math.round(delta * 100);
    return `${bps > 0 ? '+' : ''}${bps} bp`;
  }

  function cdRateValue(value) {
    return Number.isFinite(value) ? value : null;
  }

  function formatIssueShare(share) {
    return Number.isFinite(Number(share)) ? `${(Number(share) * 100).toFixed(0)}%` : '—';
  }

  function deltaClass(delta) {
    if (!Number.isFinite(delta) || Math.abs(delta) < 0.005) return 'flat';
    return delta > 0 ? 'up' : 'down';
  }

  function setupCdRecap() {
    const refresh = document.getElementById('refreshCdRecapBtn');
    if (refresh) {
      refresh.addEventListener('click', () => loadCdRecap());
    }
  }

  // ============ Treasury Notes Explorer ============

  let treasuryData = null;   // { asOfDate, notes[], sourceFile, extractedAt }
  let treasuryFilters = { search: '', minYield: null, maxMaturity: '', benchmark: '' };
  let treasurySort = { col: 'yield', dir: 'desc' };

  function hydrateTreasuryFiltersFromUrl() {
    const params = hashParamsForPage('treasury-explorer');
    if (!params.toString()) return;
    treasuryFilters = {
      search: params.get('q') || params.get('search') || '',
      minYield: numberOrNull(params.get('minYield')),
      maxMaturity: params.get('maxMaturity') || '',
      benchmark: params.get('benchmark') || ''
    };
    setControlValue('tf-search', treasuryFilters.search);
    setControlValue('tf-minyield', treasuryFilters.minYield);
    setControlValue('tf-maxmaturity', treasuryFilters.maxMaturity);
    setControlValue('tf-benchmark', treasuryFilters.benchmark);
  }

  function syncTreasuryFiltersToUrl() {
    replaceHashParams('treasury-explorer', {
      q: treasuryFilters.search,
      minYield: treasuryFilters.minYield,
      maxMaturity: treasuryFilters.maxMaturity,
      benchmark: treasuryFilters.benchmark
    });
  }

  async function loadTreasuryNotes() {
    const body = document.getElementById('treasuryExplorerBody');
    const sub = document.getElementById('treasuryExplorerSub');
    try {
      const res = await fetch('/api/treasury-notes', { cache: 'no-store' });
      if (res.status === 404) {
        treasuryData = null;
        body.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text3)">
          No treasury notes data yet. Upload today's Treasury Notes Excel file on the Upload page and notes will appear here automatically.
        </td></tr>`;
        sub.textContent = 'No treasury notes data';
        document.getElementById('treasuryExplorerStat').textContent = '0';
        document.getElementById('treasuryExplorerKicker').textContent = 'Empty';
        renderStatTiles('treasuryStatTiles', [
          { label: 'Shown', value: '0' },
          { label: 'Highest YTM', value: '—' },
          { label: 'Average YTM', value: '—' }
        ]);
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      treasuryData = await res.json();
    } catch (e) {
      console.error('Failed to load treasury notes:', e);
      body.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--danger)">
        Failed to load treasury notes: ${escapeHtml(e.message)}
      </td></tr>`;
      sub.textContent = 'Error loading treasury notes';
      return;
    }

    populateTreasuryFilters();
    hydrateTreasuryFiltersFromUrl();
    renderTreasuryNotes();
  }

  function populateTreasuryFilters() {
    if (!treasuryData || !treasuryData.notes) return;
    const notes = treasuryData.notes;
    const benchmarks = [...new Set(notes.map(n => n.benchmark).filter(Boolean))].sort();
    const select = document.getElementById('tf-benchmark');
    const keepBenchmark = select.value;
    select.innerHTML = '<option value="">All benchmarks</option>' +
      benchmarks.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    select.value = keepBenchmark;

    const asOf = treasuryData.asOfDate
      ? ` &middot; As of ${formatNumericDate(treasuryData.asOfDate)}`
      : '';
    document.getElementById('treasuryExplorerSub').innerHTML =
      `${notes.length} treasury notes available${asOf}`;
    document.getElementById('treasuryExplorerKicker').textContent =
      treasuryData.asOfDate ? formatNumericDate(treasuryData.asOfDate) : 'Current package';
  }

  function renderTreasuryNotes() {
    const body = document.getElementById('treasuryExplorerBody');
    if (!treasuryData) return;
    syncTreasuryFiltersToUrl();

    const filtered = applyTreasuryFilters(treasuryData.notes || []);
    sortTreasuryInPlace(filtered);

    document.getElementById('treasuryExplorerStat').textContent = filtered.length;
    renderStatTiles('treasuryStatTiles', [
      { label: 'Shown', value: formatNumber(filtered.length) },
      { label: 'Highest YTM', value: formatPercentTile(maxValue(filtered.map(n => n.yield)), 3) },
      { label: 'Average YTM', value: formatPercentTile(average(filtered.map(n => n.yield)), 3) }
    ]);

    if (filtered.length === 0) {
      body.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text3)">
        No treasury notes match the current filters.
      </td></tr>`;
      return;
    }

    body.innerHTML = filtered.map((n, idx) => `
      <tr>
        <td class="issuer-cell">${escapeHtml(n.description || 'Treasury Note')}</td>
        <td class="cusip-cell">${escapeHtml(n.cusip || '')}</td>
        <td style="text-align:right" class="rate-cell">${n.coupon == null ? '—' : Number(n.coupon).toFixed(3)}</td>
        <td>${n.maturity ? formatNumericDate(n.maturity) : '—'}</td>
        <td style="text-align:right" class="rate-cell">${n.yield == null ? '—' : Number(n.yield).toFixed(3)}</td>
        <td style="text-align:right">${n.price == null ? '—' : Number(n.price).toFixed(3)}</td>
        <td style="text-align:right">${n.spread == null ? '—' : formatNumber(n.spread)}</td>
        <td>${escapeHtml(n.benchmark || '')}</td>
        <td><button type="button" class="small-btn buyers-btn" data-buyers-product="treasury" data-buyers-idx="${idx}">Find buyers</button></td>
      </tr>
    `).join('');
    wireBuyersButtons(body, filtered);
  }

  function applyTreasuryFilters(notes) {
    return notes.filter(n => {
      if (treasuryFilters.search) {
        const q = treasuryFilters.search.toLowerCase();
        const haystack = [
          n.description,
          n.cusip,
          n.benchmark,
          n.type,
          ...Object.values(n.rawFields || {})
        ].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (treasuryFilters.minYield != null && !(Number(n.yield) >= treasuryFilters.minYield)) return false;
      if (treasuryFilters.maxMaturity && (!n.maturity || n.maturity > treasuryFilters.maxMaturity)) return false;
      if (treasuryFilters.benchmark && n.benchmark !== treasuryFilters.benchmark) return false;
      return true;
    });
  }

  function sortTreasuryInPlace(arr) {
    const { col, dir } = treasurySort;
    const mult = dir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      const av = a[col], bv = b[col];
      if (av == null || av === '') return 1;
      if (bv == null || bv === '') return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult;
      return String(av).localeCompare(String(bv)) * mult;
    });
  }

  function setupTreasuryFilters() {
    const search = document.getElementById('tf-search');
    const minYield = document.getElementById('tf-minyield');
    const maxMaturity = document.getElementById('tf-maxmaturity');
    const benchmark = document.getElementById('tf-benchmark');
    if (!search || !minYield || !maxMaturity || !benchmark) return;

    search.addEventListener('input', () => {
      treasuryFilters.search = search.value.trim();
      if (treasuryData) renderTreasuryNotes();
    });
    minYield.addEventListener('input', () => {
      const v = parseFloat(minYield.value);
      treasuryFilters.minYield = isNaN(v) ? null : v;
      if (treasuryData) renderTreasuryNotes();
    });
    maxMaturity.addEventListener('change', () => {
      treasuryFilters.maxMaturity = maxMaturity.value;
      if (treasuryData) renderTreasuryNotes();
    });
    benchmark.addEventListener('change', () => {
      treasuryFilters.benchmark = benchmark.value;
      if (treasuryData) renderTreasuryNotes();
    });

    document.getElementById('tf-reset').addEventListener('click', () => {
      search.value = '';
      minYield.value = '';
      maxMaturity.value = '';
      benchmark.value = '';
      treasuryFilters = { search: '', minYield: null, maxMaturity: '', benchmark: '' };
      if (treasuryData) renderTreasuryNotes();
    });

    document.getElementById('tf-export').addEventListener('click', exportTreasuryCsv);

    document.querySelectorAll('#p-treasury-explorer th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (treasurySort.col === col) {
          treasurySort.dir = treasurySort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          treasurySort.col = col;
          treasurySort.dir = ['yield', 'coupon', 'price', 'spread'].includes(col) ? 'desc' : 'asc';
        }
        document.querySelectorAll('#p-treasury-explorer th').forEach(h => {
          h.classList.remove('sort-asc', 'sort-desc');
        });
        th.classList.add(treasurySort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
        if (treasuryData) renderTreasuryNotes();
      });
    });
  }

  function exportTreasuryCsv() {
    if (!treasuryData) return showToast('No treasury notes loaded', true);
    const filtered = applyTreasuryFilters(treasuryData.notes || []);
    sortTreasuryInPlace(filtered);
    if (filtered.length === 0) return showToast('No treasury notes match filters', true);

    const rows = [
      ['Description','CUSIP','Coupon','Maturity','Settle','Net Offer YTM','Net Offer Cost','Spread','Benchmark','Type'],
      ...filtered.map(n => [
        n.description || '',
        n.cusip || '',
        n.coupon ?? '',
        n.maturity || '',
        n.settle || '',
        n.yield ?? '',
        n.price ?? '',
        n.spread ?? '',
        n.benchmark || '',
        n.type || ''
      ])
    ];
    const stamp = treasuryData.asOfDate || 'treasury_notes';
    downloadCsv(`fbbs_treasury_notes_${stamp}.csv`, rows);
    showToast(`Exported ${filtered.length} treasury notes`);
  }

  // ============ Offerings Explorer ============

  let offeringsData = null;   // { asOfDate, offerings[], sourceFile, extractedAt }
  let offeringsFilters = {
    search: '', term: '', minRate: null, minPrice: null, maxCommission: null, state: '',
    cpnFreq: '', noRestrictions: false, pricedOnly: false
  };
  let offeringsSort = { col: 'rate', dir: 'desc' };

  function hydrateOfferingsFiltersFromUrl() {
    const params = hashParamsForPage('explorer');
    if (!params.toString()) return;
    offeringsFilters = {
      search: params.get('q') || params.get('search') || '',
      term: params.get('term') || '',
      minRate: numberOrNull(params.get('minRate')),
      minPrice: numberOrNull(params.get('minPrice')),
      maxCommission: numberOrNull(params.get('maxCommission')),
      state: params.get('state') || '',
      cpnFreq: params.get('cpnFreq') || '',
      noRestrictions: params.get('noRestrictions') === '1' || params.get('noRestrictions') === 'true',
      pricedOnly: params.get('pricedOnly') === '1' || params.get('pricedOnly') === 'true'
    };
    setControlValue('ef-search', offeringsFilters.search);
    setControlValue('ef-term', offeringsFilters.term);
    setControlValue('ef-minrate', offeringsFilters.minRate);
    setControlValue('ef-minprice', offeringsFilters.minPrice);
    setControlValue('ef-maxcommission', offeringsFilters.maxCommission);
    setControlValue('ef-state', offeringsFilters.state);
    setControlValue('ef-cpn', offeringsFilters.cpnFreq);
    setControlChecked('ef-noRestrictions', offeringsFilters.noRestrictions);
    setControlChecked('ef-pricedOnly', offeringsFilters.pricedOnly);
  }

  function syncOfferingsFiltersToUrl() {
    replaceHashParams('explorer', {
      q: offeringsFilters.search,
      term: offeringsFilters.term,
      minRate: offeringsFilters.minRate,
      minPrice: offeringsFilters.minPrice,
      maxCommission: offeringsFilters.maxCommission,
      state: offeringsFilters.state,
      cpnFreq: offeringsFilters.cpnFreq,
      noRestrictions: offeringsFilters.noRestrictions,
      pricedOnly: offeringsFilters.pricedOnly
    });
  }

  async function loadOfferings() {
    const body = document.getElementById('explorerBody');
    const sub = document.getElementById('explorerSub');
    try {
      const res = await fetch('/api/offerings', { cache: 'no-store' });
      if (res.status === 404) {
        offeringsData = null;
        body.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:40px;color:var(--text3)">
          No offerings data yet. Upload today's CD Offerings PDF on the Upload page and offerings will appear here automatically.
        </td></tr>`;
        sub.textContent = 'No offerings data';
        document.getElementById('explorerStat').textContent = '0';
        document.getElementById('explorerKicker').textContent = 'Empty';
        renderStatTiles('cdStatTiles', [
          { label: 'Shown', value: '0' },
          { label: 'Highest Rate', value: '—' },
          { label: 'Average Rate', value: '—' },
          { label: 'Most Common Term', value: '—' },
          { label: 'Cost Match', value: '—' }
        ]);
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      offeringsData = await res.json();
    } catch (e) {
      console.error('Failed to load offerings:', e);
      body.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:40px;color:var(--danger)">
        Failed to load offerings: ${escapeHtml(e.message)}
      </td></tr>`;
      sub.textContent = 'Error loading offerings';
      return;
    }

    populateOfferingsFilters();
    hydrateOfferingsFiltersFromUrl();
    renderOfferings();
  }

  function populateOfferingsFilters() {
    if (!offeringsData || !offeringsData.offerings) return;
    const off = offeringsData.offerings;

    // Terms — sort by termMonths ascending
    const termMap = new Map();
    off.forEach(o => { if (!termMap.has(o.term)) termMap.set(o.term, o.termMonths); });
    const sortedTerms = [...termMap.entries()].sort((a, b) => a[1] - b[1]).map(e => e[0]);
    const termSelect = document.getElementById('ef-term');
    const keepTerm = termSelect.value;
    termSelect.innerHTML = '<option value="">All terms</option>' +
      sortedTerms.map(t => `<option value="${t}">${t}</option>`).join('');
    termSelect.value = keepTerm;

    // States
    const states = [...new Set(off.map(o => o.issuerState))].sort();
    const stateSelect = document.getElementById('ef-state');
    const keepState = stateSelect.value;
    stateSelect.innerHTML = '<option value="">All states</option>' +
      states.map(s => `<option value="${s}">${s}</option>`).join('');
    stateSelect.value = keepState;

    const asOf = offeringsData.asOfDate
      ? ` &middot; As of ${formatNumericDate(offeringsData.asOfDate)}`
      : '';
    document.getElementById('explorerSub').innerHTML =
      `${off.length} CDs available${asOf}`;
    document.getElementById('explorerKicker').textContent =
      offeringsData.asOfDate ? formatNumericDate(offeringsData.asOfDate) : 'Current package';
  }

  function renderOfferings() {
    const body = document.getElementById('explorerBody');
    if (!offeringsData) return;
    syncOfferingsFiltersToUrl();

    const filtered = applyOfferingsFilters(offeringsData.offerings);
    sortOfferingsInPlace(filtered);
    const pricedCount = (offeringsData.offerings || []).filter(o => Number.isFinite(Number(o.cost)) || Number.isFinite(Number(o.commission))).length;
    const totalCount = (offeringsData.offerings || []).length || 0;

    document.getElementById('explorerStat').textContent = filtered.length;
    renderStatTiles('cdStatTiles', [
      { label: 'Shown', value: formatNumber(filtered.length) },
      { label: 'Highest Rate', value: formatPercentTile(maxValue(filtered.map(o => o.rate)), 2) },
      { label: 'Average Rate', value: formatPercentTile(average(filtered.map(o => o.rate)), 2) },
      { label: 'Most Common Term', value: mostCommonTerm(filtered) },
      { label: 'Cost Match', value: totalCount ? `${formatNumber(pricedCount)} / ${formatNumber(totalCount)}` : '—' }
    ]);

    if (filtered.length === 0) {
      body.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:40px;color:var(--text3)">
        No offerings match the current filters.
      </td></tr>`;
      return;
    }

    body.innerHTML = filtered.map((o, idx) => `
      <tr>
        <td><span class="term-pill">${escapeHtml(o.term)}</span></td>
        <td class="issuer-cell">${escapeHtml(o.name)}</td>
        <td style="text-align:right" class="rate-cell">${o.rate.toFixed(2)}</td>
        <td>${formatNumericDate(o.maturity)}</td>
        <td class="cusip-cell">${escapeHtml(o.cusip)}</td>
        <td>${formatNumericDate(o.settle)}</td>
        <td>${escapeHtml(o.issuerState)}</td>
        <td>${o.restrictions.length
          ? `<span class="restrict-chip" title="Not available in: ${escapeHtml(o.restrictions.join(', '))}">${escapeHtml(o.restrictions.join(', '))}</span>`
          : '<span class="no-restrict">&mdash;</span>'}</td>
        <td class="cpn-cell">${escapeHtml(o.couponFrequency || '')}</td>
        <td style="text-align:right">${formatCdPrice(o.cost)}</td>
        <td style="text-align:right">${formatCdCommission(o.commission)}</td>
        <td><button type="button" class="small-btn buyers-btn" data-buyers-product="cd" data-buyers-idx="${idx}">Find buyers</button></td>
      </tr>
    `).join('');
    wireBuyersButtons(body, filtered);
  }

  function formatCdPrice(value) {
    const n = Number(value);
    if (!isFinite(n)) return '<span class="no-restrict">&mdash;</span>';
    return `<span class="rate-cell">${n.toFixed(3)}</span>`;
  }

  function formatCdCommission(value) {
    const n = Number(value);
    if (!isFinite(n)) return '<span class="no-restrict">&mdash;</span>';
    return `<span class="rate-cell">$${n.toFixed(2)}</span>`;
  }

  function applyOfferingsFilters(offerings) {
    return offerings.filter(o => {
      if (offeringsFilters.search) {
        const q = offeringsFilters.search.toLowerCase();
        if (!o.name.toLowerCase().includes(q) && !o.cusip.toLowerCase().includes(q)) return false;
      }
      if (offeringsFilters.term && o.term !== offeringsFilters.term) return false;
      if (offeringsFilters.minRate != null && o.rate < offeringsFilters.minRate) return false;
      if (offeringsFilters.minPrice != null && !passesNumberMinimum(o.cost, offeringsFilters.minPrice)) return false;
      if (offeringsFilters.maxCommission != null && !passesNumberMaximum(o.commission, offeringsFilters.maxCommission)) return false;
      if (offeringsFilters.state && o.issuerState !== offeringsFilters.state) return false;
      if (offeringsFilters.cpnFreq && o.couponFrequency !== offeringsFilters.cpnFreq) return false;
      if (offeringsFilters.noRestrictions && o.restrictions.length > 0) return false;
      if (offeringsFilters.pricedOnly && !Number.isFinite(Number(o.cost)) && !Number.isFinite(Number(o.commission))) return false;
      return true;
    });
  }

  function passesNumberMinimum(value, minimum) {
    const n = Number(value);
    return Number.isFinite(n) && n >= minimum;
  }

  function passesNumberMaximum(value, maximum) {
    const n = Number(value);
    return Number.isFinite(n) && n <= maximum;
  }

  function sortOfferingsInPlace(arr) {
    const { col, dir } = offeringsSort;
    const mult = dir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let av = a[col], bv = b[col];
      // For term, sort by termMonths for numeric order
      if (col === 'term') { av = a.termMonths; bv = b.termMonths; }
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult;
      return String(av).localeCompare(String(bv)) * mult;
    });
  }

  function setupOfferingsFilters() {
    const search = document.getElementById('ef-search');
    const term = document.getElementById('ef-term');
    const minRate = document.getElementById('ef-minrate');
    const minPrice = document.getElementById('ef-minprice');
    const maxCommission = document.getElementById('ef-maxcommission');
    const state = document.getElementById('ef-state');
    const cpn = document.getElementById('ef-cpn');
    const noRestrict = document.getElementById('ef-noRestrictions');
    const pricedOnly = document.getElementById('ef-pricedOnly');

    search.addEventListener('input', () => {
      offeringsFilters.search = search.value.trim();
      if (offeringsData) renderOfferings();
    });
    term.addEventListener('change', () => {
      offeringsFilters.term = term.value;
      if (offeringsData) renderOfferings();
    });
    minRate.addEventListener('input', () => {
      const v = parseFloat(minRate.value);
      offeringsFilters.minRate = isNaN(v) ? null : v;
      if (offeringsData) renderOfferings();
    });
    minPrice.addEventListener('input', () => {
      const v = parseFloat(minPrice.value);
      offeringsFilters.minPrice = isNaN(v) ? null : v;
      if (offeringsData) renderOfferings();
    });
    maxCommission.addEventListener('input', () => {
      const v = parseFloat(maxCommission.value);
      offeringsFilters.maxCommission = isNaN(v) ? null : v;
      if (offeringsData) renderOfferings();
    });
    state.addEventListener('change', () => {
      offeringsFilters.state = state.value;
      if (offeringsData) renderOfferings();
    });
    cpn.addEventListener('change', () => {
      offeringsFilters.cpnFreq = cpn.value;
      if (offeringsData) renderOfferings();
    });
    noRestrict.addEventListener('change', () => {
      offeringsFilters.noRestrictions = noRestrict.checked;
      if (offeringsData) renderOfferings();
    });
    pricedOnly.addEventListener('change', () => {
      offeringsFilters.pricedOnly = pricedOnly.checked;
      if (offeringsData) renderOfferings();
    });

    document.getElementById('ef-reset').addEventListener('click', () => {
      search.value = '';
      term.value = '';
      minRate.value = '';
      minPrice.value = '';
      maxCommission.value = '';
      state.value = '';
      cpn.value = '';
      noRestrict.checked = false;
      pricedOnly.checked = false;
      offeringsFilters = { search: '', term: '', minRate: null, minPrice: null, maxCommission: null, state: '', cpnFreq: '', noRestrictions: false, pricedOnly: false };
      if (offeringsData) renderOfferings();
    });

    document.getElementById('ef-export').addEventListener('click', exportOfferingsCsv);

    // Column header sorting
    document.querySelectorAll('#p-explorer th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (offeringsSort.col === col) {
          offeringsSort.dir = offeringsSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          offeringsSort.col = col;
          offeringsSort.dir = (col === 'rate' || col === 'maturity' || col === 'cost' || col === 'commission') ? 'desc' : 'asc';
        }
        document.querySelectorAll('#p-explorer th').forEach(h => {
          h.classList.remove('sort-asc', 'sort-desc');
        });
        th.classList.add(offeringsSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
        if (offeringsData) renderOfferings();
      });
    });
  }

  function exportOfferingsCsv() {
    if (!offeringsData) return showToast('No offerings loaded', true);
    const filtered = applyOfferingsFilters(offeringsData.offerings);
    sortOfferingsInPlace(filtered);
    if (filtered.length === 0) return showToast('No offerings match filters', true);

    const header = ['Term','Issuer','Rate','Maturity','CUSIP','Settle','IssuerState','Restrictions','CouponFreq','Price','Commission'];
    const rows = filtered.map(o => [
      o.term, o.name, o.rate.toFixed(2), o.maturity, o.cusip, o.settle,
      o.issuerState, o.restrictions.join('|'), o.couponFrequency || '',
      o.cost != null ? Number(o.cost).toFixed(3) : '',
      o.commission != null ? Number(o.commission).toFixed(2) : ''
    ]);
    const csv = [header, ...rows]
      .map(r => r.map(csvEscape).join(','))
      .join('\n');

    const stamp = offeringsData.asOfDate || 'offerings';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fbbs_cd_offerings_${stamp}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    showToast(`Exported ${filtered.length} offerings`);
  }

  // ============ Muni Offerings Explorer ============

  let muniData = null;
  let muniFilters = {
    search: '',
    section: '',        // '', 'BQ', 'Municipals', 'Taxable'
    state: '',
    minCoupon: null,
    minYtw: null,
    callable: '',       // '', 'callable', 'noncall'
    rated: '',          // '', 'both', 'moodys', 'sp', 'unrated'
    showBaird: true
  };
  let muniSort = { col: 'maturity', dir: 'asc' };

  function hydrateMuniFiltersFromUrl() {
    const params = hashParamsForPage('muni-explorer');
    if (!params.toString()) return;
    muniFilters = {
      search: params.get('q') || params.get('search') || '',
      section: params.get('section') || '',
      state: params.get('state') || '',
      minCoupon: numberOrNull(params.get('minCoupon')),
      minYtw: numberOrNull(params.get('minYtw')),
      callable: params.get('callable') || '',
      rated: params.get('rated') || '',
      showBaird: params.get('showBaird') !== '0'
    };
    setControlValue('mf-search', muniFilters.search);
    setControlValue('mf-section', muniFilters.section);
    setControlValue('mf-state', muniFilters.state);
    setControlValue('mf-minCoupon', muniFilters.minCoupon);
    setControlValue('mf-minYtw', muniFilters.minYtw);
    setControlValue('mf-callable', muniFilters.callable);
    setControlValue('mf-rated', muniFilters.rated);
    const showBaird = document.getElementById('mf-showBaird');
    if (showBaird) showBaird.checked = muniFilters.showBaird;
  }

  function syncMuniFiltersToUrl() {
    replaceHashParams('muni-explorer', {
      q: muniFilters.search,
      section: muniFilters.section,
      state: muniFilters.state,
      minCoupon: muniFilters.minCoupon,
      minYtw: muniFilters.minYtw,
      callable: muniFilters.callable,
      rated: muniFilters.rated,
      showBaird: muniFilters.showBaird ? null : '0'
    });
  }

  async function loadMuniOfferings() {
    const body = document.getElementById('muniExplorerBody');
    const sub = document.getElementById('muniExplorerSub');
    try {
      const res = await fetch('/api/muni-offerings', { cache: 'no-store' });
      if (res.status === 404) {
        muniData = null;
        body.innerHTML = `<tr><td colspan="18" style="text-align:center;padding:40px;color:var(--text3)">
          No muni offerings yet. Upload the Muni Offerings PDF on the Upload page and offerings will appear here automatically.
        </td></tr>`;
        sub.textContent = 'No muni offerings data';
        document.getElementById('muniExplorerStat').textContent = '0';
        document.getElementById('muniExplorerKicker').textContent = 'Empty';
        renderStatTiles('muniStatTiles', [
          { label: 'Shown', value: '0' },
          { label: 'Average YTW', value: '—' },
          { label: 'Callable', value: '—' },
          { label: 'Taxable', value: '—' }
        ]);
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      muniData = await res.json();
    } catch (e) {
      console.error('Failed to load muni offerings:', e);
      body.innerHTML = `<tr><td colspan="18" style="text-align:center;padding:40px;color:var(--danger)">
        Failed to load muni offerings: ${escapeHtml(e.message)}
      </td></tr>`;
      sub.textContent = 'Error loading offerings';
      return;
    }

    populateMuniFilters();
    hydrateMuniFiltersFromUrl();
    renderMuniOfferings();
  }

  function populateMuniFilters() {
    if (!muniData || !muniData.offerings) return;
    const off = muniData.offerings;

    const states = [...new Set(off.map(o => o.issuerState))].sort();
    const stateSelect = document.getElementById('mf-state');
    const keepState = stateSelect.value;
    stateSelect.innerHTML = '<option value="">All states</option>' +
      states.map(s => `<option value="${s}">${s}</option>`).join('');
    stateSelect.value = keepState;

    const asOf = muniData.asOfDate
      ? ` &middot; As of ${formatNumericDate(muniData.asOfDate)}`
      : '';
    document.getElementById('muniExplorerSub').innerHTML =
      `${off.length} muni bonds available${asOf}`;
    document.getElementById('muniExplorerKicker').textContent =
      muniData.asOfDate ? formatNumericDate(muniData.asOfDate) : 'Current package';
  }

  function clampMuniPercent(value, fallback, max = 100) {
    return window.FbbsMuniTax.clampPercent(value, fallback, max);
  }

  function muniTaxOptions() {
    return { asOfDate: muniData && muniData.asOfDate };
  }

  function muniDisallowancePct(row) {
    return window.FbbsMuniTax.disallowancePct(row, muniTaxSettings);
  }

  function muniTefraHaircutBps(row) {
    return window.FbbsMuniTax.tefraHaircutBps(row, muniTaxSettings);
  }

  function muniTey(rowOrYield, rate = muniTaxSettings.rate) {
    return window.FbbsMuniTax.tey(rowOrYield, muniTaxSettings, rate);
  }

  function yearsToMaturity(row) {
    return window.FbbsMuniTax.yearsToMaturity(row, muniTaxOptions());
  }

  function muniDeMinimis(row) {
    return window.FbbsMuniTax.deMinimis(row, muniTaxOptions());
  }

  function fullYearsToMaturity(row) {
    return window.FbbsMuniTax.fullYearsToMaturity(row, muniTaxOptions());
  }

  function solveBondYieldWithRedemption(couponPct, price, endDateStr, settleDateStr, redemptionValue) {
    return window.FbbsMuniTax.solveYieldWithRedemption(couponPct, price, endDateStr, settleDateStr, redemptionValue, muniTaxOptions());
  }

  function muniAfterTaxYield(row) {
    return window.FbbsMuniTax.afterTaxYield(row, muniTaxSettings, muniTaxOptions());
  }

  function muniTaxAdjustedYield(row) {
    return window.FbbsMuniTax.taxAdjustedYield(row, muniTaxSettings, muniTaxOptions());
  }

  function muniAudienceLabel() {
    const aud = MUNI_TAX_AUDIENCES[muniTaxSettings.audience];
    const label = aud ? aud.label : 'Custom';
    return `${label} ${Number(muniTaxSettings.rate).toFixed(1)}%`;
  }

  function renderMuniTaxAssumptionNote() {
    const el = document.getElementById('muniTaxAssumptionNote');
    if (!el) return;
    const aud = MUNI_TAX_AUDIENCES[muniTaxSettings.audience];
    const label = aud ? aud.label : 'Custom';
    const tefra = muniTaxSettings.applyTefra
      ? `COF ${Number(muniTaxSettings.costOfFunds).toFixed(2)}%, BQ disallowance ${Number(muniTaxSettings.bqDisallowance).toFixed(0)}%, general-market disallowance ${Number(muniTaxSettings.generalDisallowance).toFixed(0)}%`
      : 'no TEFRA haircut';
    el.textContent = `Using ${label}: ordinary tax ${Number(muniTaxSettings.rate).toFixed(1)}%, capital gains ${Number(muniTaxSettings.capitalGainsRate).toFixed(1)}%, ${tefra}. Consult a tax advisor for account-specific treatment; FBBS does not give tax advice.`;
  }

  function bestMuniTey(rows) {
    return rows
      .map(row => ({ row, adjusted: muniTaxAdjustedYield(row) }))
      .filter(item => item.adjusted && Number.isFinite(item.adjusted.value))
      .sort((a, b) => muniTaxSortValue(b.adjusted) - muniTaxSortValue(a.adjusted))[0] || null;
  }

  function muniTaxSortValue(adjustedYield) {
    return adjustedYield ? adjustedYield.value : null;
  }

  function renderMuniOfferings() {
    const body = document.getElementById('muniExplorerBody');
    if (!muniData) return;
    syncMuniFiltersToUrl();

    const filtered = applyMuniFilters(muniData.offerings);
    sortMuniInPlace(filtered);
    const topTey = bestMuniTey(filtered);
    renderMuniTaxAssumptionNote();

    document.getElementById('muniExplorerStat').textContent = filtered.length;
    renderStatTiles('muniStatTiles', [
      { label: 'Shown', value: formatNumber(filtered.length) },
      { label: 'Baird Syndicate', value: formatNumber(filtered.filter(o => o.isSyndicate).length) },
      { label: 'Average YTW', value: formatPercentTile(average(filtered.map(o => o.ytw)), 3) },
      { label: 'Top TEY/ATY', value: topTey ? formatPercentTile(muniTaxSortValue(topTey.adjusted), 3) : '—' },
      { label: 'TEY Setting', value: muniAudienceLabel() },
      { label: 'Taxable', value: formatNumber(filtered.filter(o => o.section === 'Taxable').length) }
    ]);

    if (filtered.length === 0) {
      body.innerHTML = `<tr><td colspan="18" style="text-align:center;padding:40px;color:var(--text3)">
        No offerings match the current filters.
      </td></tr>`;
      return;
    }

    body.innerHTML = filtered.map((o, idx) => {
      const ratings = [];
      if (o.moodysRating) ratings.push(`<span class="rating-moody" title="Moody's">${escapeHtml(o.moodysRating)}</span>`);
      if (o.spRating)     ratings.push(`<span class="rating-sp" title="S&amp;P">${escapeHtml(o.spRating)}</span>`);
      const ratingCell = ratings.length ? ratings.join('<br>') : '<span class="no-restrict">&mdash;</span>';

      // Yield / pricing cell: show YTW % or spread, whichever is present
      let yieldCell;
      if (o.ytw != null) {
        yieldCell = `<span class="rate-cell">${o.ytw.toFixed(3)}</span>`;
      } else if (o.spread) {
        yieldCell = `<span class="spread-chip">${escapeHtml(o.spread)}</span>`;
      } else {
        yieldCell = '<span class="no-restrict">&mdash;</span>';
      }
      const adjustedYield = muniTaxAdjustedYield(o);
      const teyCell = !adjustedYield
        ? '<span class="no-restrict">&mdash;</span>'
        : `<span class="tax-yield-cell"><span class="rate-cell tey-cell ${muniTaxSortValue(adjustedYield) >= 4 ? 'beats' : ''}">${adjustedYield.value.toFixed(3)}</span><small>${adjustedYield.label}</small>${Number.isFinite(adjustedYield.secondaryValue) ? `<span class="tax-yield-secondary">${adjustedYield.secondaryValue.toFixed(3)} ${adjustedYield.secondaryLabel}</span>` : ''}</span>`;

      const haircutBps = muniTefraHaircutBps(o);
      const haircutCell = haircutBps > 0
        ? `<span class="rate-cell">${haircutBps.toFixed(1)}</span>`
        : '<span class="no-restrict">&mdash;</span>';

      const deMin = muniDeMinimis(o);
      const deMinCell = !deMin || !deMin.isDiscount
        ? '<span class="no-restrict">&mdash;</span>'
        : `<span class="demin-chip ${deMin.isDeMinimis ? 'breach' : 'ok'}" title="Threshold ${deMin.threshold.toFixed(3)} using ${deMin.fullYears} full years">${deMin.isDeMinimis ? 'Below' : 'Above'} ${deMin.cushion.toFixed(3)}</span>`;

      const priceCell = o.price != null
        ? `<span class="rate-cell">${o.price.toFixed(3)}</span>`
        : '<span class="no-restrict">&mdash;</span>';

      const callCell = o.callDate
        ? formatNumericDate(o.callDate)
        : '<span class="no-restrict">&mdash;</span>';

      const creditCell = o.creditEnhancement
        ? `<span class="credit-chip">${escapeHtml(o.creditEnhancement)}</span>`
        : '<span class="no-restrict">&mdash;</span>';
      const source = o.source || (o.isSyndicate ? 'Baird Syndicate' : 'FBBS');
      const sourceCell = o.isSyndicate
        ? `<span class="source-pill source-baird">${escapeHtml(source)}</span>`
        : `<span class="source-pill source-fbbs">${escapeHtml(source)}</span>`;

      return `
        <tr>
          <td><span class="section-pill section-${o.section.toLowerCase()}">${escapeHtml(o.section)}</span></td>
          <td>${sourceCell}</td>
          <td class="rating-cell">${ratingCell}</td>
          <td style="text-align:right" class="qnty-cell">${o.quantity.toLocaleString()}</td>
          <td>${escapeHtml(o.issuerState)}</td>
          <td class="issuer-cell">${escapeHtml(o.issuerName)}</td>
          <td>${escapeHtml(o.issueType)}</td>
          <td style="text-align:right">${o.coupon.toFixed(3)}</td>
          <td>${formatNumericDate(o.maturity)}</td>
          <td>${callCell}</td>
          <td style="text-align:right">${yieldCell}</td>
          <td style="text-align:right">${teyCell}</td>
          <td style="text-align:right">${haircutCell}</td>
          <td style="text-align:right">${deMinCell}</td>
          <td style="text-align:right">${priceCell}</td>
          <td class="cusip-cell">${escapeHtml(o.cusip)}</td>
          <td>${creditCell}</td>
          <td><button type="button" class="small-btn buyers-btn" data-buyers-product="muni" data-buyers-idx="${idx}">Find buyers</button></td>
        </tr>
      `;
    }).join('');
    wireBuyersButtons(body, filtered);
  }

  function applyMuniFilters(offerings) {
    return offerings.filter(o => {
      if (!muniFilters.showBaird && o.isSyndicate) return false;
      if (muniFilters.search) {
        const q = muniFilters.search.toLowerCase();
        const haystack = [o.issuerName, o.cusip, o.source].map(v => String(v || '').toLowerCase()).join(' ');
        if (!haystack.includes(q)) return false;
      }
      if (muniFilters.section && o.section !== muniFilters.section) return false;
      if (muniFilters.state && o.issuerState !== muniFilters.state) return false;
      if (muniFilters.minCoupon != null && o.coupon < muniFilters.minCoupon) return false;
      if (muniFilters.minYtw != null && (o.ytw == null || o.ytw < muniFilters.minYtw)) return false;
      if (muniFilters.callable === 'callable' && !o.callDate) return false;
      if (muniFilters.callable === 'noncall' && o.callDate) return false;
      if (muniFilters.rated === 'both' && !(o.moodysRating && o.spRating)) return false;
      if (muniFilters.rated === 'moodys' && !o.moodysRating) return false;
      if (muniFilters.rated === 'sp' && !o.spRating) return false;
      if (muniFilters.rated === 'unrated' && (o.moodysRating || o.spRating)) return false;
      return true;
    });
  }

  function sortMuniInPlace(arr) {
    const { col, dir } = muniSort;
    const mult = dir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let av;
      let bv;
      if (col === 'taxAdjustedYield') {
        av = muniTaxSortValue(muniTaxAdjustedYield(a));
        bv = muniTaxSortValue(muniTaxAdjustedYield(b));
      } else if (col === 'tefraHaircutBps') {
        av = muniTefraHaircutBps(a);
        bv = muniTefraHaircutBps(b);
      } else if (col === 'deMinimisCushion') {
        av = muniDeMinimis(a)?.cushion;
        bv = muniDeMinimis(b)?.cushion;
      } else {
        av = a[col];
        bv = b[col];
      }
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult;
      return String(av).localeCompare(String(bv)) * mult;
    });
  }

  function setupMuniFilters() {
    const search    = document.getElementById('mf-search');
    const section   = document.getElementById('mf-section');
    const state     = document.getElementById('mf-state');
    const minCoupon = document.getElementById('mf-minCoupon');
    const minYtw    = document.getElementById('mf-minYtw');
    const callable  = document.getElementById('mf-callable');
    const rated     = document.getElementById('mf-rated');
    const showBaird = document.getElementById('mf-showBaird');
    const customRate = document.getElementById('muniCustomTaxRate');
    const capitalGainsRate = document.getElementById('muniCapitalGainsRate');
    const costOfFunds = document.getElementById('muniCostOfFunds');
    const bqDisallowance = document.getElementById('muniBqDisallowance');
    const generalDisallowance = document.getElementById('muniGeneralDisallowance');

    if (!search) return; // page not in DOM yet; shouldn't happen but defensive

    const syncMuniTaxInputs = () => {
      if (customRate) customRate.value = String(muniTaxSettings.rate);
      if (capitalGainsRate) capitalGainsRate.value = String(muniTaxSettings.capitalGainsRate);
      if (costOfFunds) costOfFunds.value = Number(muniTaxSettings.costOfFunds).toFixed(2);
      if (bqDisallowance) bqDisallowance.value = String(muniTaxSettings.bqDisallowance);
      if (generalDisallowance) generalDisallowance.value = String(muniTaxSettings.generalDisallowance);
      renderMuniTaxAssumptionNote();
    };

    const rerenderMuniTax = () => {
      renderMuniTaxAssumptionNote();
      if (muniData) renderMuniOfferings();
      renderRelativeValueNative();
    };

    document.querySelectorAll('[data-muni-tax-audience]').forEach(btn => {
      btn.addEventListener('click', () => {
        const audience = btn.dataset.muniTaxAudience;
        const config = MUNI_TAX_AUDIENCES[audience];
        if (!config) return;
        muniTaxSettings = { audience, ...config };
        syncMuniTaxInputs();
        document.querySelectorAll('[data-muni-tax-audience]').forEach(item => {
          item.classList.toggle('active', item === btn);
        });
        rerenderMuniTax();
      });
    });

    if (customRate) {
      customRate.addEventListener('input', () => {
        const rate = parseFloat(customRate.value);
        if (!Number.isFinite(rate) || rate < 0 || rate >= 100) return;
        muniTaxSettings = { ...muniTaxSettings, audience: 'custom', rate };
        document.querySelectorAll('[data-muni-tax-audience]').forEach(item => item.classList.remove('active'));
        rerenderMuniTax();
      });
    }
    if (capitalGainsRate) {
      capitalGainsRate.addEventListener('input', () => {
        const rate = parseFloat(capitalGainsRate.value);
        if (!Number.isFinite(rate) || rate < 0 || rate >= 100) return;
        muniTaxSettings = { ...muniTaxSettings, audience: 'custom', capitalGainsRate: rate };
        document.querySelectorAll('[data-muni-tax-audience]').forEach(item => item.classList.remove('active'));
        rerenderMuniTax();
      });
    }
    if (costOfFunds) {
      costOfFunds.addEventListener('input', () => {
        const rate = parseFloat(costOfFunds.value);
        if (!Number.isFinite(rate) || rate < 0) return;
        muniTaxSettings = { ...muniTaxSettings, audience: 'custom', costOfFunds: clampMuniPercent(rate, 0, 20), applyTefra: rate > 0 };
        document.querySelectorAll('[data-muni-tax-audience]').forEach(item => item.classList.remove('active'));
        rerenderMuniTax();
      });
    }
    if (bqDisallowance) {
      bqDisallowance.addEventListener('input', () => {
        const pct = parseFloat(bqDisallowance.value);
        if (!Number.isFinite(pct) || pct < 0) return;
        muniTaxSettings = { ...muniTaxSettings, audience: 'custom', bqDisallowance: clampMuniPercent(pct, 0), applyTefra: true };
        document.querySelectorAll('[data-muni-tax-audience]').forEach(item => item.classList.remove('active'));
        rerenderMuniTax();
      });
    }
    if (generalDisallowance) {
      generalDisallowance.addEventListener('input', () => {
        const pct = parseFloat(generalDisallowance.value);
        if (!Number.isFinite(pct) || pct < 0) return;
        muniTaxSettings = { ...muniTaxSettings, audience: 'custom', generalDisallowance: clampMuniPercent(pct, 0), applyTefra: true };
        document.querySelectorAll('[data-muni-tax-audience]').forEach(item => item.classList.remove('active'));
        rerenderMuniTax();
      });
    }
    syncMuniTaxInputs();

    search.addEventListener('input', () => {
      muniFilters.search = search.value.trim();
      if (muniData) renderMuniOfferings();
    });
    section.addEventListener('change', () => {
      muniFilters.section = section.value;
      if (muniData) renderMuniOfferings();
    });
    state.addEventListener('change', () => {
      muniFilters.state = state.value;
      if (muniData) renderMuniOfferings();
    });
    minCoupon.addEventListener('input', () => {
      const v = parseFloat(minCoupon.value);
      muniFilters.minCoupon = isNaN(v) ? null : v;
      if (muniData) renderMuniOfferings();
    });
    minYtw.addEventListener('input', () => {
      const v = parseFloat(minYtw.value);
      muniFilters.minYtw = isNaN(v) ? null : v;
      if (muniData) renderMuniOfferings();
    });
    callable.addEventListener('change', () => {
      muniFilters.callable = callable.value;
      if (muniData) renderMuniOfferings();
    });
    rated.addEventListener('change', () => {
      muniFilters.rated = rated.value;
      if (muniData) renderMuniOfferings();
    });
    if (showBaird) {
      showBaird.addEventListener('change', () => {
        muniFilters.showBaird = showBaird.checked;
        if (muniData) renderMuniOfferings();
      });
    }

    document.getElementById('mf-reset').addEventListener('click', () => {
      search.value = '';
      section.value = '';
      state.value = '';
      minCoupon.value = '';
      minYtw.value = '';
      callable.value = '';
      rated.value = '';
      if (showBaird) showBaird.checked = true;
      muniFilters = { search: '', section: '', state: '', minCoupon: null, minYtw: null, callable: '', rated: '', showBaird: true };
      if (muniData) renderMuniOfferings();
    });

    document.getElementById('mf-export').addEventListener('click', exportMuniCsv);

    document.querySelectorAll('#p-muni-explorer th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (muniSort.col === col) {
          muniSort.dir = muniSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          muniSort.col = col;
          // Sensible default direction per column
          muniSort.dir = (col === 'coupon' || col === 'ytw' || col === 'taxAdjustedYield' || col === 'tefraHaircutBps' || col === 'price' || col === 'quantity' || col === 'maturity')
            ? 'desc' : 'asc';
        }
        document.querySelectorAll('#p-muni-explorer th').forEach(h => {
          h.classList.remove('sort-asc', 'sort-desc');
        });
        th.classList.add(muniSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
        if (muniData) renderMuniOfferings();
      });
    });
  }

  function exportMuniCsv() {
    if (!muniData) return showToast('No muni offerings loaded', true);
    const filtered = applyMuniFilters(muniData.offerings);
    sortMuniInPlace(filtered);
    if (filtered.length === 0) return showToast('No offerings match filters', true);

    const header = ['Section','Source','Moodys','SP','Quantity','State','Issuer','IssueType',
                    'Coupon','Maturity','CallDate','YTW','TaxAdjustedYield','TaxAdjustedYieldType',
                    'DiscountATY','DiscountATYType',
                    'OrdinaryTaxRate','CapitalGainsRate','CostOfFunds','DisallowancePct',
                    'TEFRAHaircutBps','DeMinimisFullYears','DeMinimisThreshold','DeMinimisCushion','DeMinimisStatus',
                    'YTM','Price','Spread','Settle','CouponDate','CUSIP','CreditEnhancement',
                    'TaxDisclaimer'];
    const rows = filtered.map(o => {
      const adjustedYield = muniTaxAdjustedYield(o);
      const deMin = muniDeMinimis(o);
      const disallowance = muniDisallowancePct(o);
      return [
        o.section, o.source || (o.isSyndicate ? 'Baird Syndicate' : 'FBBS'),
        o.moodysRating || '', o.spRating || '', o.quantity,
        o.issuerState, o.issuerName, o.issueType,
        o.coupon.toFixed(3), o.maturity,
        o.callDate || '',
        o.ytw != null ? o.ytw.toFixed(3) : '',
        adjustedYield ? adjustedYield.value.toFixed(3) : '',
        adjustedYield ? adjustedYield.label : '',
        adjustedYield && Number.isFinite(adjustedYield.secondaryValue) ? adjustedYield.secondaryValue.toFixed(3) : '',
        adjustedYield && adjustedYield.secondaryLabel ? adjustedYield.secondaryLabel : '',
        Number(muniTaxSettings.rate).toFixed(1),
        Number(muniTaxSettings.capitalGainsRate).toFixed(1),
        Number(muniTaxSettings.costOfFunds).toFixed(2),
        disallowance.toFixed(0),
        muniTefraHaircutBps(o).toFixed(1),
        deMin ? deMin.fullYears : '',
        deMin ? deMin.threshold.toFixed(3) : '',
        deMin ? deMin.cushion.toFixed(3) : '',
        deMin && deMin.isDiscount ? (deMin.isDeMinimis ? 'Below de minimis' : 'Above de minimis') : '',
        o.ytm != null ? o.ytm.toFixed(3) : '',
        o.price != null ? o.price.toFixed(3) : '',
        o.spread || '',
        o.settle, o.couponDate, o.cusip,
        o.creditEnhancement || '',
        'Uses visible portal assumptions. Consult a tax advisor for account-specific treatment; FBBS does not give tax advice.'
      ];
    });
    const csv = [header, ...rows]
      .map(r => r.map(csvEscape).join(','))
      .join('\n');

    const stamp = muniData.asOfDate || 'muni_offerings';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fbbs_muni_offerings_${stamp}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    showToast(`Exported ${filtered.length} muni offerings`);
  }

  // ============ Agencies Explorer ============

  let agencyData = null;
  let agencyTreasuryData = null;
  let agencyFilters = {
    search: '',
    tickers: new Set(),        // multi-select
    structures: new Set(),     // 'Bullet', 'Callable'
    callTypes: new Set(),
    maturityFrom: null,        // ISO
    maturityTo: null,
    nextCallFrom: null,
    nextCallTo: null,
    minCoupon: null,
    maxCoupon: null,
    minYtm: null,
    minYtnc: null,
    minPrice: null,
    maxPrice: null,
    minQty: null
  };
  let agencySort = { col: 'maturity', dir: 'asc' };

  function hydrateAgencyFiltersFromUrl() {
    const params = hashParamsForPage('agencies');
    if (!params.toString()) return;
    agencyFilters = {
      search: params.get('q') || params.get('search') || '',
      tickers: hashParamSet(params, 'tickers'),
      structures: hashParamSet(params, 'structures'),
      callTypes: hashParamSet(params, 'callTypes'),
      maturityFrom: params.get('maturityFrom') || null,
      maturityTo: params.get('maturityTo') || null,
      nextCallFrom: params.get('nextCallFrom') || null,
      nextCallTo: params.get('nextCallTo') || null,
      minCoupon: numberOrNull(params.get('minCoupon')),
      maxCoupon: numberOrNull(params.get('maxCoupon')),
      minYtm: numberOrNull(params.get('minYtm')),
      minYtnc: numberOrNull(params.get('minYtnc')),
      minPrice: numberOrNull(params.get('minPrice')),
      maxPrice: numberOrNull(params.get('maxPrice')),
      minQty: numberOrNull(params.get('minQty'))
    };
    setControlValue('af-search', agencyFilters.search);
    [
      ['af-matFrom', agencyFilters.maturityFrom],
      ['af-matTo', agencyFilters.maturityTo],
      ['af-callFrom', agencyFilters.nextCallFrom],
      ['af-callTo', agencyFilters.nextCallTo],
      ['af-minCoupon', agencyFilters.minCoupon],
      ['af-maxCoupon', agencyFilters.maxCoupon],
      ['af-minYtm', agencyFilters.minYtm],
      ['af-minYtnc', agencyFilters.minYtnc],
      ['af-minPrice', agencyFilters.minPrice],
      ['af-maxPrice', agencyFilters.maxPrice],
      ['af-minQty', agencyFilters.minQty]
    ].forEach(([id, value]) => setControlValue(id, value));
    setCheckedValues('#af-structures input[type="checkbox"]', agencyFilters.structures);
    setCheckedValues('#af-tickers input[type="checkbox"]', agencyFilters.tickers);
    setCheckedValues('#af-callTypes input[type="checkbox"]', agencyFilters.callTypes);
  }

  function syncAgencyFiltersToUrl() {
    replaceHashParams('agencies', {
      q: agencyFilters.search,
      tickers: agencyFilters.tickers,
      structures: agencyFilters.structures,
      callTypes: agencyFilters.callTypes,
      maturityFrom: agencyFilters.maturityFrom,
      maturityTo: agencyFilters.maturityTo,
      nextCallFrom: agencyFilters.nextCallFrom,
      nextCallTo: agencyFilters.nextCallTo,
      minCoupon: agencyFilters.minCoupon,
      maxCoupon: agencyFilters.maxCoupon,
      minYtm: agencyFilters.minYtm,
      minYtnc: agencyFilters.minYtnc,
      minPrice: agencyFilters.minPrice,
      maxPrice: agencyFilters.maxPrice,
      minQty: agencyFilters.minQty
    });
  }

  async function loadAgencies() {
    const body = document.getElementById('agenciesBody');
    const sub = document.getElementById('agenciesSub');
    try {
      const [res, treasury] = await Promise.all([
        fetch('/api/agencies', { cache: 'no-store' }),
        loadAgencyTreasuryData()
      ]);
      agencyTreasuryData = treasury;
      if (res.status === 404) {
        agencyData = null;
        body.innerHTML = `<tr><td colspan="13" style="text-align:center;padding:40px;color:var(--text3)">
          No agency offerings uploaded yet. Drop bullets + callables Excel files on the Upload page.
        </td></tr>`;
        sub.textContent = 'No agency data';
        document.getElementById('agenciesStat').textContent = '0';
        document.getElementById('agenciesKicker').textContent = 'Empty';
        renderStatTiles('agencyStatTiles', [
          { label: 'Shown', value: '0' },
          { label: 'Bullets', value: '—' },
          { label: 'Callables', value: '—' },
          { label: 'Average YTM', value: '—' }
        ]);
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      agencyData = await res.json();
    } catch (e) {
      console.error('Failed to load agencies:', e);
      body.innerHTML = `<tr><td colspan="13" style="text-align:center;padding:40px;color:var(--danger)">
        Failed to load agencies: ${escapeHtml(e.message)}
      </td></tr>`;
      sub.textContent = 'Error';
      return;
    }
    populateAgencyFilters();
    hydrateAgencyFiltersFromUrl();
    renderAgencies();
  }

  function populateAgencyFilters() {
    if (!agencyData || !agencyData.offerings) return;
    const off = agencyData.offerings;

    // Build ticker checklist from the data
    const tickers = [...new Set(off.map(o => o.ticker))].filter(Boolean).sort();
    const tickerBox = document.getElementById('af-tickers');
    tickerBox.innerHTML = tickers.map(t => `
      <label class="chk-pill">
        <input type="checkbox" value="${escapeHtml(t)}" ${agencyFilters.tickers.has(t) ? 'checked' : ''}>
        <span>${escapeHtml(t)}</span>
      </label>`).join('');

    // Call types checklist (from data — handles whatever the trader sends)
    const callTypes = [...new Set(off.map(o => o.callType).filter(Boolean))].sort();
    const ctBox = document.getElementById('af-callTypes');
    ctBox.innerHTML = callTypes.length
      ? callTypes.map(t => `
          <label class="chk-pill">
            <input type="checkbox" value="${escapeHtml(t)}" ${agencyFilters.callTypes.has(t) ? 'checked' : ''}>
            <span>${escapeHtml(t)}</span>
          </label>`).join('')
      : '<span class="no-restrict">— no call types in data —</span>';

    // Wire up check-listeners (event delegation)
    tickerBox.onchange = e => {
      if (e.target.matches('input[type="checkbox"]')) {
        const v = e.target.value;
        if (e.target.checked) agencyFilters.tickers.add(v); else agencyFilters.tickers.delete(v);
        if (agencyData) renderAgencies();
      }
    };
    ctBox.onchange = e => {
      if (e.target.matches('input[type="checkbox"]')) {
        const v = e.target.value;
        if (e.target.checked) agencyFilters.callTypes.add(v); else agencyFilters.callTypes.delete(v);
        if (agencyData) renderAgencies();
      }
    };

    const fdate = agencyData.fileDate ? ` &middot; File dated ${formatNumericDate(agencyData.fileDate)}` : '';
    const udate = agencyData.uploadedAt ? ` &middot; Uploaded ${formatNumericDate(agencyData.uploadedAt.slice(0,10))}` : '';
    document.getElementById('agenciesSub').innerHTML = `${off.length} agency offerings${udate}${fdate}`;
    document.getElementById('agenciesKicker').textContent = agencyData.fileDate
      ? `File ${formatNumericDate(agencyData.fileDate)}`
      : 'Current';
    renderCommissionControl('agencies', 'agencyStatTiles');
  }

  async function loadAgencyTreasuryData() {
    try {
      const res = await fetch('/api/economic-update', { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      return Array.isArray(data && data.treasuries) && data.treasuries.length ? data : null;
    } catch (e) {
      return null;
    }
  }

  function agencySpreadBasis(record, priceOverride, yields) {
    if (!record) return null;
    const price = priceOverride == null ? record.askPrice : priceOverride;
    const ytm = yields ? yields.ytm : record.ytm;
    const ytnc = yields ? yields.ytnc : record.ytnc;
    const isPremium = Number(price) >= 100;

    if (record.structure === 'Callable' && isPremium && record.nextCallDate && ytnc != null) {
      return { date: record.nextCallDate, yieldPct: ytnc, label: 'call', key: 'ytnc' };
    }
    if (record.maturity && ytm != null) {
      return { date: record.maturity, yieldPct: ytm, label: 'maturity', key: 'ytm' };
    }
    if (record.nextCallDate && ytnc != null) {
      return { date: record.nextCallDate, yieldPct: ytnc, label: 'call', key: 'ytnc' };
    }
    return null;
  }

  function effectiveAgencyBenchmark(record) {
    if (record && record.structure !== 'Callable' && record.benchmark) return record.benchmark;
    const treasury = treasuryForAgencyRecord(record);
    if (treasury) return treasury.label;
    return record && record.benchmark ? record.benchmark : null;
  }

  function effectiveAgencySpread(record) {
    if (!record) return null;
    if (record.structure !== 'Callable' && record.askSpread != null) return record.askSpread;
    const basis = agencySpreadBasis(record);
    const treasury = treasuryForAgencyRecord(record);
    if (!basis || !treasury || treasury.yield == null) return null;
    return (basis.yieldPct - treasury.yield) * 100;
  }

  function treasuryForAgencyRecord(record) {
    const basis = agencySpreadBasis(record);
    return treasuryForAgencyBasis(basis);
  }

  function treasuryForAgencyBasis(basis) {
    const curve = agencyTreasuryCurve();
    if (!basis || !curve.length) return null;
    const months = monthsBetween(new Date(), parseIsoDate(basis.date));
    if (!isFinite(months) || months <= 0) return null;
    return interpolateTreasuryYield(curve, months);
  }

  function agencyTreasuryCurve() {
    const rows = Array.isArray(agencyTreasuryData && agencyTreasuryData.treasuries)
      ? agencyTreasuryData.treasuries
      : [];
    return rows
      .map(row => ({
        months: tenorToMonths(row.tenor),
        label: row.label || row.tenor,
        yield: row.yield
      }))
      .filter(row => row.months != null && row.yield != null)
      .sort((a, b) => a.months - b.months);
  }

  function tenorToMonths(tenor) {
    const match = String(tenor || '').match(/^(\d+)(MO|M|YR|Y)$/i);
    if (!match) return null;
    const n = Number(match[1]);
    if (!isFinite(n)) return null;
    return /^M/i.test(match[2]) ? n : n * 12;
  }

  function interpolateTreasuryYield(curve, targetMonths) {
    if (!curve.length) return null;
    if (targetMonths <= curve[0].months) {
      return { ...curve[0], label: curve[0].label };
    }
    const last = curve[curve.length - 1];
    if (targetMonths >= last.months) {
      return { ...last, label: last.label };
    }
    for (let i = 1; i < curve.length; i++) {
      const left = curve[i - 1];
      const right = curve[i];
      if (targetMonths <= right.months) {
        const weight = (targetMonths - left.months) / (right.months - left.months);
        const interpolated = left.yield + ((right.yield - left.yield) * weight);
        return {
          months: targetMonths,
          yield: interpolated,
          label: nearestTreasuryLabel(left, right, targetMonths)
        };
      }
    }
    return null;
  }

  function nearestTreasuryLabel(left, right, targetMonths) {
    const nearest = Math.abs(targetMonths - left.months) <= Math.abs(right.months - targetMonths)
      ? left
      : right;
    return nearest.label;
  }

  function applyAgencyFilters(offerings) {
    const f = agencyFilters;
    return offerings.filter(o => {
      if (f.search) {
        const q = f.search.toLowerCase();
        if (!(o.cusip && o.cusip.toLowerCase().includes(q)) &&
            !(o.ticker && o.ticker.toLowerCase().includes(q))) return false;
      }
      if (f.structures.size > 0 && !f.structures.has(o.structure)) return false;
      if (f.callTypes.size > 0 && !f.callTypes.has(o.callType)) return false;
      if (f.maturityFrom && (!o.maturity || o.maturity < f.maturityFrom)) return false;
      if (f.maturityTo   && (!o.maturity || o.maturity > f.maturityTo))   return false;
      if (f.nextCallFrom && (!o.nextCallDate || o.nextCallDate < f.nextCallFrom)) return false;
      if (f.nextCallTo   && (!o.nextCallDate || o.nextCallDate > f.nextCallTo))   return false;
      if (f.minCoupon != null && (o.coupon == null || o.coupon < f.minCoupon)) return false;
      if (f.maxCoupon != null && (o.coupon == null || o.coupon > f.maxCoupon)) return false;
      if (f.minYtm != null && (o.ytm == null || o.ytm < f.minYtm)) return false;
      if (f.minYtnc != null && (o.ytnc == null || o.ytnc < f.minYtnc)) return false;
      if (f.minPrice != null && (o.askPrice == null || o.askPrice < f.minPrice)) return false;
      if (f.maxPrice != null && (o.askPrice == null || o.askPrice > f.maxPrice)) return false;
      if (f.minQty != null && (o.availableSize == null || o.availableSize < f.minQty)) return false;
      return true;
    });
  }

  function sortAgenciesInPlace(arr) {
    const { col, dir } = agencySort;
    const mult = dir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let av = a[col], bv = b[col];
      if (col === 'askSpread') {
        av = effectiveAgencySpread(a);
        bv = effectiveAgencySpread(b);
      }
      if (col === 'benchmark') {
        av = effectiveAgencyBenchmark(a);
        bv = effectiveAgencyBenchmark(b);
      }
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult;
      return String(av).localeCompare(String(bv)) * mult;
    });
  }

  function renderAgencies() {
    const body = document.getElementById('agenciesBody');
    if (!agencyData) return;
    syncAgencyFiltersToUrl();
    const filtered = applyAgencyFilters(agencyData.offerings);
    sortAgenciesInPlace(filtered);
    document.getElementById('agenciesStat').textContent = filtered.length;
    renderStatTiles('agencyStatTiles', [
      { label: 'Shown', value: formatNumber(filtered.length) },
      { label: 'Bullets', value: formatNumber(filtered.filter(o => o.structure === 'Bullet').length) },
      { label: 'Callables', value: formatNumber(filtered.filter(o => o.structure === 'Callable').length) },
      { label: 'Average YTM', value: formatPercentTile(average(filtered.map(o => o.ytm)), 3) }
    ]);

    if (filtered.length === 0) {
      body.innerHTML = `<tr><td colspan="14" style="text-align:center;padding:40px;color:var(--text3)">
        No agencies match the current filters.
      </td></tr>`;
      return;
    }

    const fmt = (v, d = 3) => v == null ? '<span class="no-restrict">&mdash;</span>' : v.toFixed(d);
    const fmtDate = v => v ? formatNumericDate(v) : '<span class="no-restrict">&mdash;</span>';

    body.innerHTML = filtered.map((o, idx) => {
      const structureClass = o.structure === 'Bullet' ? 'structure-bullet' : 'structure-callable';
      const benchmark = effectiveAgencyBenchmark(o);
      return `
        <tr>
          <td><span class="structure-pill ${structureClass}">${escapeHtml(o.structure)}</span></td>
          <td><span class="ticker-pill">${escapeHtml(o.ticker || '')}</span></td>
          <td class="cusip-cell">${escapeHtml(o.cusip || '')}</td>
          <td style="text-align:right">${fmt(o.coupon, 3)}</td>
          <td>${fmtDate(o.maturity)}</td>
          <td>${fmtDate(o.nextCallDate)}</td>
          <td>${o.callType ? `<span class="calltype-chip">${escapeHtml(o.callType)}</span>` : '<span class="no-restrict">&mdash;</span>'}</td>
          <td style="text-align:right" class="rate-cell">${commissionYieldHtml(o, 'ytm', 3)}</td>
          <td style="text-align:right" class="rate-cell">${commissionYieldHtml(o, 'ytnc', 3)}</td>
          <td style="text-align:right">${commissionPriceHtml('agencies', o, o.askPrice, 3)}</td>
          <td style="text-align:right" class="qnty-cell">${fmt(o.availableSize, 3)}</td>
          <td style="text-align:right">${commissionSpreadHtml(o)}</td>
          <td>${benchmark ? escapeHtml(benchmark) : '<span class="no-restrict">&mdash;</span>'}</td>
          <td><button type="button" class="small-btn buyers-btn" data-buyers-product="agency" data-buyers-idx="${idx}">Find buyers</button></td>
        </tr>`;
    }).join('');

    wireBuyersButtons(body, filtered);
  }

  function setupAgencyFilters() {
    const byId = id => document.getElementById(id);
    const search = byId('af-search');
    if (!search) return;  // agencies page not in DOM

    search.addEventListener('input', () => {
      agencyFilters.search = search.value.trim();
      if (agencyData) renderAgencies();
    });

    // Structure multi-select (Bullet / Callable)
    document.querySelectorAll('#af-structures input[type="checkbox"]').forEach(el => {
      el.addEventListener('change', () => {
        if (el.checked) agencyFilters.structures.add(el.value);
        else agencyFilters.structures.delete(el.value);
        if (agencyData) renderAgencies();
      });
    });

    // Wire the date / number range fields
    const numFields = [
      ['af-matFrom', 'maturityFrom', 'str'],
      ['af-matTo',   'maturityTo',   'str'],
      ['af-callFrom','nextCallFrom', 'str'],
      ['af-callTo',  'nextCallTo',   'str'],
      ['af-minCoupon','minCoupon', 'num'],
      ['af-maxCoupon','maxCoupon', 'num'],
      ['af-minYtm',  'minYtm',  'num'],
      ['af-minYtnc', 'minYtnc', 'num'],
      ['af-minPrice','minPrice','num'],
      ['af-maxPrice','maxPrice','num'],
      ['af-minQty',  'minQty',  'num']
    ];
    for (const [id, key, kind] of numFields) {
      const el = byId(id);
      if (!el) continue;
      el.addEventListener('input', () => {
        if (kind === 'num') {
          const v = parseFloat(el.value);
          agencyFilters[key] = isNaN(v) ? null : v;
        } else {
          agencyFilters[key] = el.value || null;
        }
        if (agencyData) renderAgencies();
      });
    }

    byId('af-reset').addEventListener('click', () => {
      agencyFilters = {
        search: '', tickers: new Set(), structures: new Set(), callTypes: new Set(),
        maturityFrom: null, maturityTo: null, nextCallFrom: null, nextCallTo: null,
        minCoupon: null, maxCoupon: null, minYtm: null,
        minYtnc: null, minPrice: null, maxPrice: null, minQty: null
      };
      search.value = '';
      numFields.forEach(([id]) => { const el = byId(id); if (el) el.value = ''; });
      document.querySelectorAll('#af-structures input[type="checkbox"]').forEach(el => el.checked = false);
      document.querySelectorAll('#af-tickers  input[type="checkbox"]').forEach(el => el.checked = false);
      document.querySelectorAll('#af-callTypes input[type="checkbox"]').forEach(el => el.checked = false);
      if (agencyData) renderAgencies();
    });

    byId('af-export').addEventListener('click', exportAgenciesCsv);

    document.querySelectorAll('#p-agencies th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (agencySort.col === col) {
          agencySort.dir = agencySort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          agencySort.col = col;
          agencySort.dir = (col === 'coupon' || col === 'ytm' || col === 'ytnc' ||
                            col === 'askPrice' || col === 'availableSize') ? 'desc' : 'asc';
        }
        document.querySelectorAll('#p-agencies th').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
        th.classList.add(agencySort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
        if (agencyData) renderAgencies();
      });
    });
  }

  function exportAgenciesCsv() {
    if (!agencyData) return showToast('No agency data loaded', true);
    const filtered = applyAgencyFilters(agencyData.offerings);
    sortAgenciesInPlace(filtered);
    if (filtered.length === 0) return showToast('No offerings match filters', true);

    const header = ['Structure','Ticker','CUSIP','Coupon','Maturity','NextCallDate','CallType',
                    'SpreadBasis','SpreadYield','MarkedSpreadBasis','MarkedSpreadYield','YTM','MarkedYTM','YTNC','MarkedYTNC','AskPrice','SalesCommissionMethod','SalesCommissionValue','PriceMarkup','ClientPrice','AvailableSize','AskSpread','MarkedSpread','Benchmark',
                    'Settle','CostBasis','Notes','SourceCommissionBp'];
    const rows = filtered.map(o => {
      const marked = markedAgencyValues(o);
      const spreadBasis = agencySpreadBasis(o);
      const spread = effectiveAgencySpread(o);
      const benchmark = effectiveAgencyBenchmark(o);
      return [
      o.structure, o.ticker, o.cusip,
      o.coupon != null ? o.coupon.toFixed(3) : '',
      o.maturity || '',
      o.nextCallDate || '',
      o.callType || '',
      spreadBasis ? spreadBasis.label : '',
      spreadBasis && spreadBasis.yieldPct != null ? spreadBasis.yieldPct.toFixed(3) : '',
      marked && marked.markedSpreadBasis ? marked.markedSpreadBasis.label : '',
      marked && marked.markedSpreadBasis && marked.markedSpreadBasis.yieldPct != null ? marked.markedSpreadBasis.yieldPct.toFixed(3) : '',
      o.ytm != null ? o.ytm.toFixed(3) : '',
      marked && marked.markedYtm != null ? marked.markedYtm.toFixed(3) : '',
      o.ytnc != null ? o.ytnc.toFixed(3) : '',
      marked && marked.markedYtnc != null ? marked.markedYtnc.toFixed(3) : '',
      o.askPrice != null ? o.askPrice.toFixed(3) : '',
      marked ? marked.method : '',
      marked ? marked.value.toString() : '',
      marked ? marked.priceMarkup.toFixed(3) : '',
      marked ? marked.clientPrice.toFixed(3) : '',
      o.availableSize != null ? o.availableSize.toFixed(3) : '',
      spread != null ? spread.toFixed(1) : '',
      marked && marked.markedSpread != null ? marked.markedSpread.toFixed(1) : '',
      benchmark || '',
      o.settle || '',
      o.costBasis != null ? o.costBasis.toFixed(3) : '',
      o.notes || '',
      o.commissionBp != null ? o.commissionBp.toString() : ''
      ];
    });
    const csv = [header, ...rows]
      .map(r => r.map(csvEscape).join(','))
      .join('\n');

    const stamp = (agencyData.fileDate || 'agencies').replace(/[^a-z0-9_-]/gi, '_');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fbbs_agencies_${stamp}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    showToast(`Exported ${filtered.length} agency offerings`);
  }

  // ============ Corporates Explorer ============

  let corpData = null;
  let corpFilters = {
    search: '',
    sectors: new Set(),
    paymentRanks: new Set(),
    creditTier: '',          // '' | 'IG' | 'HY' | 'AAA/AA' | 'A' | 'BBB' | 'NR'
    callable: '',            // '' | 'callable' | 'noncall'
    maturityFrom: null,
    maturityTo: null,
    nextCallFrom: null,
    nextCallTo: null,
    minCoupon: null, maxCoupon: null,
    minYtm: null,
    minPrice: null, maxPrice: null,
    minQty: null
  };
  let corpSort = { col: 'maturity', dir: 'asc' };

  function hydrateCorpFiltersFromUrl() {
    const params = hashParamsForPage('corporates');
    if (!params.toString()) return;
    corpFilters = {
      search: params.get('q') || params.get('search') || '',
      sectors: hashParamSet(params, 'sectors'),
      paymentRanks: hashParamSet(params, 'paymentRanks'),
      creditTier: params.get('creditTier') || '',
      callable: params.get('callable') || '',
      maturityFrom: params.get('maturityFrom') || null,
      maturityTo: params.get('maturityTo') || null,
      nextCallFrom: params.get('nextCallFrom') || null,
      nextCallTo: params.get('nextCallTo') || null,
      minCoupon: numberOrNull(params.get('minCoupon')),
      maxCoupon: numberOrNull(params.get('maxCoupon')),
      minYtm: numberOrNull(params.get('minYtm')),
      minPrice: numberOrNull(params.get('minPrice')),
      maxPrice: numberOrNull(params.get('maxPrice')),
      minQty: numberOrNull(params.get('minQty'))
    };
    setControlValue('cf-search', corpFilters.search);
    setControlValue('cf-tier', corpFilters.creditTier);
    setControlValue('cf-callable', corpFilters.callable);
    [
      ['cf-matFrom', corpFilters.maturityFrom],
      ['cf-matTo', corpFilters.maturityTo],
      ['cf-callFrom', corpFilters.nextCallFrom],
      ['cf-callTo', corpFilters.nextCallTo],
      ['cf-minCoupon', corpFilters.minCoupon],
      ['cf-maxCoupon', corpFilters.maxCoupon],
      ['cf-minYtm', corpFilters.minYtm],
      ['cf-minPrice', corpFilters.minPrice],
      ['cf-maxPrice', corpFilters.maxPrice],
      ['cf-minQty', corpFilters.minQty]
    ].forEach(([id, value]) => setControlValue(id, value));
    setCheckedValues('#cf-sectors input[type="checkbox"]', corpFilters.sectors);
    setCheckedValues('#cf-ranks input[type="checkbox"]', corpFilters.paymentRanks);
  }

  function syncCorpFiltersToUrl() {
    replaceHashParams('corporates', {
      q: corpFilters.search,
      sectors: corpFilters.sectors,
      paymentRanks: corpFilters.paymentRanks,
      creditTier: corpFilters.creditTier,
      callable: corpFilters.callable,
      maturityFrom: corpFilters.maturityFrom,
      maturityTo: corpFilters.maturityTo,
      nextCallFrom: corpFilters.nextCallFrom,
      nextCallTo: corpFilters.nextCallTo,
      minCoupon: corpFilters.minCoupon,
      maxCoupon: corpFilters.maxCoupon,
      minYtm: corpFilters.minYtm,
      minPrice: corpFilters.minPrice,
      maxPrice: corpFilters.maxPrice,
      minQty: corpFilters.minQty
    });
  }

  async function loadCorporates() {
    const body = document.getElementById('corporatesBody');
    const sub = document.getElementById('corporatesSub');
    try {
      const res = await fetch('/api/corporates', { cache: 'no-store' });
      if (res.status === 404) {
        corpData = null;
        body.innerHTML = `<tr><td colspan="15" style="text-align:center;padding:40px;color:var(--text3)">
          No corporate offerings uploaded yet. Drop the corporates Excel file on the Upload page.
        </td></tr>`;
        sub.textContent = 'No corporate data';
        document.getElementById('corporatesStat').textContent = '0';
        document.getElementById('corporatesKicker').textContent = 'Empty';
        renderStatTiles('corpStatTiles', [
          { label: 'Shown', value: '0' },
          { label: 'Investment Grade', value: '—' },
          { label: 'High Yield', value: '—' },
          { label: 'Average YTM', value: '—' }
        ]);
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      corpData = await res.json();
    } catch (e) {
      console.error('Failed to load corporates:', e);
      body.innerHTML = `<tr><td colspan="15" style="text-align:center;padding:40px;color:var(--danger)">
        Failed to load corporates: ${escapeHtml(e.message)}
      </td></tr>`;
      sub.textContent = 'Error';
      return;
    }
    populateCorpFilters();
    hydrateCorpFiltersFromUrl();
    renderCorporates();
  }

  function populateCorpFilters() {
    if (!corpData || !corpData.offerings) return;
    const off = corpData.offerings;

    // Sector multi-select
    const sectors = [...new Set(off.map(o => o.sector).filter(Boolean))].sort();
    const sectorBox = document.getElementById('cf-sectors');
    sectorBox.innerHTML = sectors.map(s => `
      <label class="chk-pill">
        <input type="checkbox" value="${escapeHtml(s)}" ${corpFilters.sectors.has(s) ? 'checked' : ''}>
        <span>${escapeHtml(s)}</span>
      </label>`).join('');

    // Payment rank multi-select
    const ranks = [...new Set(off.map(o => o.paymentRank).filter(Boolean))].sort();
    const rankBox = document.getElementById('cf-ranks');
    rankBox.innerHTML = ranks.map(r => `
      <label class="chk-pill">
        <input type="checkbox" value="${escapeHtml(r)}" ${corpFilters.paymentRanks.has(r) ? 'checked' : ''}>
        <span>${escapeHtml(r)}</span>
      </label>`).join('');

    // Wire checklist listeners via delegation
    sectorBox.onchange = e => {
      if (e.target.matches('input[type="checkbox"]')) {
        if (e.target.checked) corpFilters.sectors.add(e.target.value);
        else corpFilters.sectors.delete(e.target.value);
        if (corpData) renderCorporates();
      }
    };
    rankBox.onchange = e => {
      if (e.target.matches('input[type="checkbox"]')) {
        if (e.target.checked) corpFilters.paymentRanks.add(e.target.value);
        else corpFilters.paymentRanks.delete(e.target.value);
        if (corpData) renderCorporates();
      }
    };
    const fdate = corpData.fileDate ? ` &middot; File dated ${formatNumericDate(corpData.fileDate)}` : '';
    const udate = corpData.uploadedAt ? ` &middot; Uploaded ${formatNumericDate(corpData.uploadedAt.slice(0,10))}` : '';
    document.getElementById('corporatesSub').innerHTML = `${off.length} corporate bonds${udate}${fdate}`;
    document.getElementById('corporatesKicker').textContent = corpData.fileDate
      ? `File ${formatNumericDate(corpData.fileDate)}`
      : 'Current';
    renderCommissionControl('corporates', 'corpStatTiles');
  }

  function applyCorpFilters(offerings) {
    const f = corpFilters;
    return offerings.filter(o => {
      if (f.search) {
        const q = f.search.toLowerCase();
        if (!(o.issuerName && o.issuerName.toLowerCase().includes(q)) &&
            !(o.cusip && o.cusip.toLowerCase().includes(q)) &&
            !(o.ticker && o.ticker.toLowerCase().includes(q))) return false;
      }
      if (f.sectors.size > 0 && !f.sectors.has(o.sector)) return false;
      if (f.paymentRanks.size > 0 && !f.paymentRanks.has(o.paymentRank)) return false;
      if (f.creditTier === 'IG' && !o.investmentGrade) return false;
      if (f.creditTier === 'HY' && o.investmentGrade) return false;
      if ((f.creditTier === 'AAA/AA' || f.creditTier === 'A' || f.creditTier === 'BBB' || f.creditTier === 'NR') &&
          o.creditTier !== f.creditTier) return false;
      if (f.callable === 'callable' && !o.nextCallDate) return false;
      if (f.callable === 'noncall' && o.nextCallDate) return false;
      if (f.maturityFrom && (!o.maturity || o.maturity < f.maturityFrom)) return false;
      if (f.maturityTo   && (!o.maturity || o.maturity > f.maturityTo))   return false;
      if (f.nextCallFrom && (!o.nextCallDate || o.nextCallDate < f.nextCallFrom)) return false;
      if (f.nextCallTo   && (!o.nextCallDate || o.nextCallDate > f.nextCallTo))   return false;
      if (f.minCoupon != null && (o.coupon == null || o.coupon < f.minCoupon)) return false;
      if (f.maxCoupon != null && (o.coupon == null || o.coupon > f.maxCoupon)) return false;
      if (f.minYtm != null && (o.ytm == null || o.ytm < f.minYtm)) return false;
      if (f.minPrice != null && (o.askPrice == null || o.askPrice < f.minPrice)) return false;
      if (f.maxPrice != null && (o.askPrice == null || o.askPrice > f.maxPrice)) return false;
      if (f.minQty != null && (o.availableSize == null || o.availableSize < f.minQty)) return false;
      return true;
    });
  }

  function sortCorpInPlace(arr) {
    const { col, dir } = corpSort;
    const mult = dir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let av = a[col], bv = b[col];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult;
      return String(av).localeCompare(String(bv)) * mult;
    });
  }

  function renderCorporates() {
    const body = document.getElementById('corporatesBody');
    if (!corpData) return;
    syncCorpFiltersToUrl();
    const filtered = applyCorpFilters(corpData.offerings);
    sortCorpInPlace(filtered);
    document.getElementById('corporatesStat').textContent = filtered.length;
    renderStatTiles('corpStatTiles', [
      { label: 'Shown', value: formatNumber(filtered.length) },
      { label: 'Investment Grade', value: formatNumber(filtered.filter(o => o.investmentGrade).length) },
      { label: 'High Yield', value: formatNumber(filtered.filter(o => !o.investmentGrade).length) },
      { label: 'Average YTM', value: formatPercentTile(average(filtered.map(o => o.ytm)), 3) }
    ]);

    if (filtered.length === 0) {
      body.innerHTML = `<tr><td colspan="15" style="text-align:center;padding:40px;color:var(--text3)">
        No corporates match the current filters.
      </td></tr>`;
      return;
    }

    const fmt = (v, d = 3) => v == null ? '<span class="no-restrict">&mdash;</span>' : v.toFixed(d);
    const fmtDate = v => v ? formatNumericDate(v) : '<span class="no-restrict">&mdash;</span>';
    const tierClass = t => ({
      'AAA/AA': 'tier-aaa',
      'A': 'tier-a',
      'BBB': 'tier-bbb',
      'HY': 'tier-hy',
      'NR': 'tier-nr'
    })[t] || 'tier-nr';

    body.innerHTML = filtered.map((o, idx) => {
      const ratings = [];
      if (o.moodysRating) ratings.push(`<span class="rating-moody">${escapeHtml(o.moodysRating)}</span>`);
      if (o.spRating)     ratings.push(`<span class="rating-sp">${escapeHtml(o.spRating)}</span>`);
      const ratingCell = ratings.length ? ratings.join(' ') : '<span class="no-restrict">&mdash;</span>';

      return `
        <tr>
          <td><span class="tier-pill ${tierClass(o.creditTier)}">${escapeHtml(o.creditTier)}</span></td>
          <td class="rating-cell">${ratingCell}</td>
          <td class="issuer-cell"><strong>${escapeHtml(o.issuerName || '')}</strong></td>
          <td>${o.ticker ? `<span class="ticker-pill">${escapeHtml(o.ticker)}</span>` : ''}</td>
          <td>${o.sector ? `<span class="sector-chip">${escapeHtml(o.sector)}</span>` : '<span class="no-restrict">&mdash;</span>'}</td>
          <td>${o.paymentRank ? `<span class="rank-chip ${o.paymentRank === 'Subordinated' ? 'rank-sub' : ''}">${escapeHtml(o.paymentRank)}</span>` : '<span class="no-restrict">&mdash;</span>'}</td>
          <td style="text-align:right">${fmt(o.coupon, 3)}</td>
          <td>${fmtDate(o.maturity)}</td>
          <td>${fmtDate(o.nextCallDate)}</td>
          <td style="text-align:right" class="rate-cell">${commissionCorporateYieldHtml(o, 'ytm', 3)}</td>
          <td style="text-align:right" class="rate-cell">${commissionCorporateYieldHtml(o, 'ytnc', 3)}</td>
          <td style="text-align:right">${commissionPriceHtml('corporates', o, o.askPrice, 3)}</td>
          <td style="text-align:right" class="qnty-cell">${fmt(o.availableSize, 0)}</td>
          <td class="cusip-cell">${escapeHtml(o.cusip || '')}</td>
          <td><button type="button" class="small-btn buyers-btn" data-buyers-product="corporate" data-buyers-idx="${idx}">Find buyers</button></td>
        </tr>`;
    }).join('');
    wireBuyersButtons(body, filtered);
  }

  function setupCorpFilters() {
    const byId = id => document.getElementById(id);
    const search = byId('cf-search');
    if (!search) return;

    search.addEventListener('input', () => {
      corpFilters.search = search.value.trim();
      if (corpData) renderCorporates();
    });

    byId('cf-tier').addEventListener('change', e => {
      corpFilters.creditTier = e.target.value;
      if (corpData) renderCorporates();
    });

    byId('cf-callable').addEventListener('change', e => {
      corpFilters.callable = e.target.value;
      if (corpData) renderCorporates();
    });

    const numFields = [
      ['cf-matFrom', 'maturityFrom', 'str'],
      ['cf-matTo',   'maturityTo',   'str'],
      ['cf-callFrom','nextCallFrom', 'str'],
      ['cf-callTo',  'nextCallTo',   'str'],
      ['cf-minCoupon','minCoupon', 'num'],
      ['cf-maxCoupon','maxCoupon', 'num'],
      ['cf-minYtm',  'minYtm',  'num'],
      ['cf-minPrice','minPrice','num'],
      ['cf-maxPrice','maxPrice','num'],
      ['cf-minQty',  'minQty',  'num']
    ];
    for (const [id, key, kind] of numFields) {
      const el = byId(id);
      if (!el) continue;
      el.addEventListener('input', () => {
        if (kind === 'num') {
          const v = parseFloat(el.value);
          corpFilters[key] = isNaN(v) ? null : v;
        } else {
          corpFilters[key] = el.value || null;
        }
        if (corpData) renderCorporates();
      });
    }

    byId('cf-reset').addEventListener('click', () => {
      corpFilters = {
        search: '', sectors: new Set(), paymentRanks: new Set(),
        creditTier: '', callable: '',
        maturityFrom: null, maturityTo: null, nextCallFrom: null, nextCallTo: null,
        minCoupon: null, maxCoupon: null, minYtm: null,
        minPrice: null, maxPrice: null, minQty: null
      };
      search.value = '';
      byId('cf-tier').value = '';
      byId('cf-callable').value = '';
      numFields.forEach(([id]) => { const el = byId(id); if (el) el.value = ''; });
      document.querySelectorAll('#cf-sectors input[type="checkbox"]').forEach(el => el.checked = false);
      document.querySelectorAll('#cf-ranks input[type="checkbox"]').forEach(el => el.checked = false);
      if (corpData) renderCorporates();
    });

    byId('cf-export').addEventListener('click', exportCorpCsv);

    document.querySelectorAll('#p-corporates th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (corpSort.col === col) {
          corpSort.dir = corpSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          corpSort.col = col;
          corpSort.dir = (col === 'coupon' || col === 'ytm' || col === 'ytnc' ||
                          col === 'askPrice' || col === 'availableSize') ? 'desc' : 'asc';
        }
        document.querySelectorAll('#p-corporates th').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
        th.classList.add(corpSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
        if (corpData) renderCorporates();
      });
    });
  }

  function exportCorpCsv() {
    if (!corpData) return showToast('No corporate data loaded', true);
    const filtered = applyCorpFilters(corpData.offerings);
    sortCorpInPlace(filtered);
    if (filtered.length === 0) return showToast('No offerings match filters', true);

    const header = ['CreditTier','Moodys','SP','Issuer','Ticker','Sector','PaymentRank',
                    'Coupon','Maturity','NextCallDate','YTM','MarkedYTM','YTNC','MarkedYTNC',
                    'AskPrice','SalesCommissionMethod','SalesCommissionValue','PriceMarkup','ClientPrice',
                    'AvailableSize','AmtOut','Series','CUSIP','AskSpread','MarkedSpread','Benchmark','FloaterSpread'];
    const rows = filtered.map(o => {
      const marked = markedCorporateValues(o);
      return [
      o.creditTier, o.moodysRating || '', o.spRating || '',
      o.issuerName, o.ticker || '', o.sector || '', o.paymentRank || '',
      o.coupon != null ? o.coupon.toFixed(3) : '',
      o.maturity || '',
      o.nextCallDate || '',
      o.ytm != null ? o.ytm.toFixed(3) : '',
      marked && marked.markedYtm != null ? marked.markedYtm.toFixed(3) : '',
      o.ytnc != null ? o.ytnc.toFixed(3) : '',
      marked && marked.markedYtnc != null ? marked.markedYtnc.toFixed(3) : '',
      o.askPrice != null ? o.askPrice.toFixed(3) : '',
      marked ? marked.method : '',
      marked ? marked.value.toString() : '',
      marked ? marked.priceMarkup.toFixed(3) : '',
      marked ? marked.clientPrice.toFixed(3) : '',
      o.availableSize != null ? o.availableSize.toFixed(0) : '',
      o.amtOutRaw || '',
      o.series || '',
      o.cusip,
      o.askSpread != null ? o.askSpread.toString() : '',
      marked && marked.markedSpread != null ? marked.markedSpread.toFixed(1) : '',
      o.benchmark || '',
      o.floaterSpread != null ? o.floaterSpread.toString() : ''
      ];
    });
    const csv = [header, ...rows]
      .map(r => r.map(csvEscape).join(','))
      .join('\n');

    const stamp = (corpData.fileDate || 'corporates').replace(/[^a-z0-9_-]/gi, '_');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fbbs_corporates_${stamp}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    showToast(`Exported ${filtered.length} corporate offerings`);
  }

  // ============ MBS / CMO Explorer ============

  let mbsCmoFilters = {
    search: '',
    source: '',
    minYield: null,
    maxWal: null,
    minSpread: null,
    settleFrom: null,
    maturityTo: null
  };
  let mbsCmoSort = { col: 'createdAt', dir: 'desc' };
  let mbsCmoView = 'all';

  async function loadMbsCmo() {
    const body = document.getElementById('mbsCmoBody');
    if (!body) return;
    try {
      const res = await fetch('/api/mbs-cmo', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      mbsCmoData = await res.json();
    } catch (e) {
      console.error('Failed to load MBS/CMO:', e);
      body.innerHTML = `<tr><td colspan="15" style="text-align:center;padding:40px;color:var(--danger)">
        Failed to load MBS/CMO inventory: ${escapeHtml(e.message)}
      </td></tr>`;
      return;
    }
    renderMbsCmo();
  }

  function applyMbsCmoFilters(offers) {
    const f = mbsCmoFilters;
    return offers.filter(o => {
      if (mbsCmoView === 'mbs' && o.productType !== 'MBS') return false;
      if (mbsCmoView === 'cmo' && o.productType !== 'CMO') return false;
      if (mbsCmoView === 'email' && o.sourceType !== 'Email Offer') return false;
      if (f.search) {
        const q = f.search.toLowerCase();
        const haystack = [
          o.description, o.cusip, o.productType, o.sourceType, o.note,
          o.emailSubject, o.emailFrom, ...(o.sourceFiles || []).map(file => file.filename)
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (f.source && o.sourceType !== f.source) return false;
      if (f.minYield != null && (o.yield == null || o.yield < f.minYield)) return false;
      if (f.maxWal != null && (o.wal == null || o.wal > f.maxWal)) return false;
      if (f.minSpread != null && (o.spread == null || o.spread < f.minSpread)) return false;
      if (f.settleFrom && (!o.settleDate || o.settleDate < f.settleFrom)) return false;
      if (f.maturityTo && (!o.maturityDate || o.maturityDate > f.maturityTo)) return false;
      return true;
    });
  }

  function sortMbsCmoInPlace(rows) {
    const { col, dir } = mbsCmoSort;
    const mult = dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const av = a[col], bv = b[col];
      if (av == null || av === '') return 1;
      if (bv == null || bv === '') return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult;
      return String(av).localeCompare(String(bv)) * mult;
    });
  }

  function updateMbsCmoTabs(offers, sources) {
    setText('mbsCmoTabAll', formatNumber(offers.length));
    setText('mbsCmoTabMbs', formatNumber(offers.filter(o => o.productType === 'MBS').length));
    setText('mbsCmoTabCmo', formatNumber(offers.filter(o => o.productType === 'CMO').length));
    setText('mbsCmoTabEmail', formatNumber(offers.filter(o => o.sourceType === 'Email Offer').length));
    setText('mbsCmoTabSources', formatNumber(sources.length));

    document.querySelectorAll('.mbs-cmo-tab').forEach(tab => {
      const active = tab.dataset.mbsCmoView === mbsCmoView;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function sourceMatchesMbsCmoFilters(source) {
    const q = mbsCmoFilters.search.toLowerCase();
    if (mbsCmoFilters.source) {
      const ext = String(source.extension || '').toLowerCase();
      if (mbsCmoFilters.source === 'Bloomberg Workbook' && !['xlsm', 'xlsx', 'xlsb', 'xls'].includes(ext)) return false;
      if (mbsCmoFilters.source === 'PDF Offering' && ext !== 'pdf') return false;
      if (mbsCmoFilters.source === 'Email Offer' && ext !== 'eml') return false;
      if (mbsCmoFilters.source === 'Screen Snip' && !['png', 'jpg', 'jpeg'].includes(ext)) return false;
    }
    if (!q) return true;
    return [source.filename, source.extension, source.uploadedAt]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q);
  }

  function renderMbsCmoSources(sources) {
    const body = document.getElementById('mbsCmoSourcesBody');
    if (!body) return;
    const filtered = sources.filter(sourceMatchesMbsCmoFilters);
    setText('mbsCmoStat', formatNumber(filtered.length));
    if (!filtered.length) {
      body.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--text3)">
        ${sources.length ? 'No source files match the current filters.' : 'No source files uploaded yet.'}
      </td></tr>`;
      return;
    }
    body.innerHTML = filtered.map(source => `
      <tr>
        <td class="issuer-cell">${escapeHtml(source.filename || 'Source file')}</td>
        <td><span class="rank-chip">${escapeHtml((source.extension || 'file').toUpperCase())}</span></td>
        <td style="text-align:right">${escapeHtml(formatFileSize(source.size))}</td>
        <td>${escapeHtml(formatFullTimestamp(source.uploadedAt))}</td>
        <td>
          <a class="source-chip" href="/api/mbs-cmo/files/${encodeURIComponent(source.id)}" target="_blank" rel="noopener">
            Open
          </a>
        </td>
      </tr>
    `).join('');
  }

  function renderMbsCmo() {
    const body = document.getElementById('mbsCmoBody');
    if (!body || !mbsCmoData) return;
    const offers = Array.isArray(mbsCmoData.offers) ? mbsCmoData.offers : [];
    const sources = Array.isArray(mbsCmoData.sources) ? mbsCmoData.sources : [];
    const filtered = applyMbsCmoFilters(offers);
    sortMbsCmoInPlace(filtered);

    updateMbsCmoTabs(offers, sources);
    const sourceCount = sources.length;
    const uploaded = mbsCmoData.uploadedAt ? `Updated ${formatFullTimestamp(mbsCmoData.uploadedAt)}` : 'No uploads yet';
    setText('mbsCmoKicker', `${uploaded} · ${formatNumber(sourceCount)} source files`);
    setText('mbsCmoSub', `${formatNumber(offers.length)} modeled rows from ${formatNumber(sourceCount)} uploaded sources`);
    const offerWrap = document.querySelector('#p-mbs-cmo .mbs-cmo-table')?.closest('.explorer-table-wrap');
    const sourcesWrap = document.getElementById('mbsCmoSourcesWrap');
    const showingSources = mbsCmoView === 'sources';
    if (offerWrap) offerWrap.hidden = showingSources;
    if (sourcesWrap) sourcesWrap.hidden = !showingSources;
    if (showingSources) {
      const sourceFiltered = sources.filter(sourceMatchesMbsCmoFilters);
      renderStatTiles('mbsCmoStatTiles', [
        { label: 'Shown', value: formatNumber(sourceFiltered.length) },
        { label: 'Workbooks', value: formatNumber(sourceFiltered.filter(s => ['xlsm', 'xlsx', 'xlsb', 'xls'].includes(String(s.extension || '').toLowerCase())).length) },
        { label: 'PDFs', value: formatNumber(sourceFiltered.filter(s => String(s.extension || '').toLowerCase() === 'pdf').length) },
        { label: 'Emails', value: formatNumber(sourceFiltered.filter(s => String(s.extension || '').toLowerCase() === 'eml').length) },
        { label: 'Screen Snips', value: formatNumber(sourceFiltered.filter(s => ['png', 'jpg', 'jpeg'].includes(String(s.extension || '').toLowerCase())).length) }
      ]);
      renderMbsCmoSources(sources);
      return;
    }

    renderStatTiles('mbsCmoStatTiles', [
      { label: 'Shown', value: formatNumber(filtered.length) },
      { label: 'CMOs', value: formatNumber(filtered.filter(o => o.productType === 'CMO').length) },
      { label: 'MBS', value: formatNumber(filtered.filter(o => o.productType === 'MBS').length) },
      { label: 'Avg Yield', value: formatPercentTile(average(filtered.map(o => o.yield)), 2) },
      { label: 'Avg WAL', value: average(filtered.map(o => o.wal)) == null ? '—' : average(filtered.map(o => o.wal)).toFixed(2) }
    ]);

    setText('mbsCmoStat', formatNumber(filtered.length));
    if (!offers.length) {
      body.innerHTML = `<tr><td colspan="15" style="text-align:center;padding:40px;color:var(--text3)">
        No MBS/CMO sources uploaded yet. Use the source drop above to add Bloomberg workbooks, PDFs, offer emails, or screenshots.
      </td></tr>`;
      return;
    }
    if (!filtered.length) {
      body.innerHTML = `<tr><td colspan="15" style="text-align:center;padding:40px;color:var(--text3)">
        No MBS/CMO rows match the current filters.
      </td></tr>`;
      return;
    }

    const fmt = (v, d = 2) => v == null || isNaN(v) ? '<span class="no-restrict">&mdash;</span>' : Number(v).toFixed(d);
    const fmtFace = v => v == null || isNaN(v) ? '<span class="no-restrict">&mdash;</span>' : formatNumber(Math.round(Number(v)));
    const fmtDate = v => v ? formatNumericDate(v) : '<span class="no-restrict">&mdash;</span>';
    const pillClass = p => p === 'CMO' ? 'tier-a' : p === 'MBS' ? 'tier-bbb' : 'tier-nr';

    body.innerHTML = filtered.map((o, idx) => {
      const files = (o.sourceFiles || []).map(file => `
        <a class="source-chip" href="/api/mbs-cmo/files/${encodeURIComponent(file.id)}" target="_blank" rel="noopener">
          ${escapeHtml(file.extension || 'file')}
        </a>
      `).join('');
      const note = o.note ? `<div class="mbs-note">${escapeHtml(o.note).slice(0, 360)}</div>` : '';
      return `
        <tr>
          <td><span class="tier-pill ${pillClass(o.productType)}">${escapeHtml(o.productType || 'MBS/CMO')}</span></td>
          <td class="issuer-cell"><strong>${escapeHtml(o.description || o.emailSubject || 'Offer note')}</strong>${note}</td>
          <td class="cusip-cell">${escapeHtml(o.cusip || '')}</td>
          <td style="text-align:right">${fmtFace(o.originalFace)}</td>
          <td style="text-align:right">${fmtFace(o.currentFace)}</td>
          <td style="text-align:right">${fmt(o.coupon, 3)}</td>
          <td style="text-align:right">${fmt(o.price, 3)}</td>
          <td style="text-align:right" class="rate-cell">${fmt(o.yield, 3)}</td>
          <td style="text-align:right">${fmt(o.wal, 2)}</td>
          <td style="text-align:right">${fmt(o.spread, 0)}</td>
          <td>${escapeHtml(o.principalWindow || '')}</td>
          <td>${fmtDate(o.settleDate)}</td>
          <td><span class="rank-chip">${escapeHtml(o.sourceType || '')}</span></td>
          <td>${files || '<span class="no-restrict">&mdash;</span>'}</td>
          <td><button type="button" class="small-btn buyers-btn" data-buyers-product="mbs" data-buyers-idx="${idx}">Find buyers</button></td>
        </tr>`;
    }).join('');
    wireBuyersButtons(body, filtered);
  }

  async function loadCdInternal() {
    const body = document.getElementById('cdInternalBody');
    if (!body) return;
    try {
      const res = await fetch('/api/cd-internal', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      cdInternalData = await res.json();
    } catch (e) {
      body.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--danger)">Failed to load internal CD workbook: ${escapeHtml(e.message)}</td></tr>`;
      return;
    }
    renderCdInternal();
  }

  function renderCdInternal() {
    const body = document.getElementById('cdInternalBody');
    if (!body || !cdInternalData) return;
    const rows = Array.isArray(cdInternalData.offerings) ? cdInternalData.offerings : [];
    setText('cdInternalStat', formatNumber(rows.length));
    setText('cdInternalKicker', cdInternalData.uploadedAt ? `Updated ${formatFullTimestamp(cdInternalData.uploadedAt)}` : 'No internal workbook yet');
    setText('cdInternalSub', `${formatNumber(rows.length)} private CD rows from ${formatNumber((cdInternalData.sources || []).length)} workbook source${(cdInternalData.sources || []).length === 1 ? '' : 's'}`);
    renderStatTiles('cdInternalStatTiles', [
      { label: 'Rows', value: formatNumber(rows.length) },
      { label: 'FDIC Certs', value: formatNumber(new Set(rows.map(r => r.fdicNumber).filter(Boolean)).size) },
      { label: 'Restricted', value: formatNumber(rows.filter(r => (r.restrictions || []).length).length) },
      { label: 'States', value: formatNumber(new Set(rows.map(r => r.domiciled).filter(Boolean)).size) },
      { label: 'Sources', value: formatNumber((cdInternalData.sources || []).length) }
    ]);
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text3)">No internal CD workbook has been ingested yet.</td></tr>`;
      return;
    }
    body.innerHTML = rows.slice(0, 600).map(row => `
      <tr>
        <td class="issuer-cell"><strong>${escapeHtml(row.name || '')}</strong><div class="mbs-note">${escapeHtml(row.underwriter || '')}</div></td>
        <td>${escapeHtml(row.fdicNumber || '')}</td>
        <td><span class="term-pill">${escapeHtml(row.term || '')}</span></td>
        <td style="text-align:right">${row.rate == null ? '<span class="no-restrict">&mdash;</span>' : Number(row.rate).toFixed(2)}</td>
        <td>${row.maturity ? escapeHtml(formatNumericDate(row.maturity)) : '<span class="no-restrict">&mdash;</span>'}</td>
        <td>${row.settle ? escapeHtml(formatNumericDate(row.settle)) : '<span class="no-restrict">&mdash;</span>'}</td>
        <td>${escapeHtml(row.domiciled || '')}</td>
        <td>${(row.restrictions || []).length ? `<span class="restrict-chip">${escapeHtml(row.restrictions.join(', '))}</span>` : '<span class="no-restrict">&mdash;</span>'}</td>
        <td class="cusip-cell">${escapeHtml(row.cusip || '')}</td>
      </tr>
    `).join('');
  }

  async function loadStructuredNotes() {
    const body = document.getElementById('structuredNotesBody');
    if (!body) return;
    try {
      const res = await fetch('/api/structured-notes', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      structuredNotesData = await res.json();
    } catch (e) {
      body.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--danger)">Failed to load structured notes: ${escapeHtml(e.message)}</td></tr>`;
      return;
    }
    renderStructuredNotes();
  }

  function applyStructuredNotesFilters(notes) {
    const q = structuredNotesFilters.search.toLowerCase();
    return (notes || []).filter(note => {
      if (structuredNotesFilters.structure && note.structure !== structuredNotesFilters.structure) return false;
      if (!q) return true;
      const haystack = [
        note.issuer, note.rating, note.term, note.structure, note.coupon, note.cusip,
        note.pricing, note.emailSubject, note.emailFrom, note.attachment
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }

  function renderStructuredNotes() {
    const body = document.getElementById('structuredNotesBody');
    if (!body || !structuredNotesData) return;
    const notes = Array.isArray(structuredNotesData.notes) ? structuredNotesData.notes : [];
    const structures = [...new Set(notes.map(n => n.structure).filter(Boolean))].sort();
    const select = document.getElementById('sn-structure');
    if (select) {
      const keep = select.value;
      select.innerHTML = '<option value="">All structures</option>' + structures.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
      select.value = keep;
    }

    const filtered = applyStructuredNotesFilters(notes);
    filtered.sort((a, b) => String(a.pricing || '').localeCompare(String(b.pricing || '')) || String(a.issuer || '').localeCompare(String(b.issuer || '')));
    setText('structuredNotesStat', formatNumber(filtered.length));
    setText('structuredNotesKicker', structuredNotesData.uploadedAt ? `Updated ${formatFullTimestamp(structuredNotesData.uploadedAt)}` : 'No notes parsed yet');
    setText('structuredNotesSub', `${formatNumber(notes.length)} notes from ${formatNumber((structuredNotesData.sources || []).length)} source emails`);
    renderStatTiles('structuredNotesStatTiles', [
      { label: 'Shown', value: formatNumber(filtered.length) },
      { label: 'Issuers', value: formatNumber(new Set(filtered.map(n => n.issuer).filter(Boolean)).size) },
      { label: 'Callable', value: formatNumber(filtered.filter(n => /call/i.test(n.structure || '')).length) },
      { label: 'Zeros', value: formatNumber(filtered.filter(n => /zero/i.test(n.structure || '')).length) },
      { label: 'Avg Price', value: average(filtered.map(n => n.price)) == null ? '—' : average(filtered.map(n => n.price)).toFixed(2) }
    ]);

    if (!notes.length) {
      body.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text3)">No structured-note emails have been ingested yet. Drop Bloomberg note emails into the daily folder, then publish the folder.</td></tr>`;
      return;
    }
    if (!filtered.length) {
      body.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text3)">No notes match the current filters.</td></tr>`;
      return;
    }
    body.innerHTML = filtered.map(note => {
      const source = (note.sourceFiles || [])[0];
      const sourceLink = source ? `<a class="source-chip" href="/api/structured-notes/files/${encodeURIComponent(source.id)}" target="_blank" rel="noopener">eml</a>` : '<span class="no-restrict">&mdash;</span>';
      const priceDisplay = structuredNotePriceDisplay(note);
      const pricingDisplay = structuredNotePricingDisplay(note);
      // When the parser couldn't isolate an issuer, fall back to the email
      // subject as the primary label rather than printing the literal word
      // "Issuer" — and don't repeat the subject on the sub-line.
      const issuerPrimary = note.issuer || note.emailSubject || 'Unspecified issuer';
      const issuerSub = note.issuer ? (note.emailSubject || '') : '';
      return `
        <tr>
          <td class="issuer-cell"><strong>${escapeHtml(issuerPrimary)}</strong>${issuerSub ? `<div class="mbs-note">${escapeHtml(issuerSub)}</div>` : ''}</td>
          <td>${escapeHtml(note.rating || '')}</td>
          <td><span class="term-pill">${escapeHtml(note.term || '')}</span></td>
          <td>${escapeHtml(note.coupon || note.structure || '')}<div class="mbs-note">${escapeHtml(note.structure || '')}</div></td>
          <td>${note.maturityDate ? escapeHtml(formatNumericDate(note.maturityDate)) : '<span class="no-restrict">&mdash;</span>'}</td>
          <td>${escapeHtml(note.firstCall || '')}</td>
          <td style="text-align:right">${priceDisplay ? escapeHtml(priceDisplay) : '<span class="no-restrict">&mdash;</span>'}</td>
          <td class="cusip-cell">${escapeHtml(note.cusip || '')}</td>
          <td>${pricingDisplay ? escapeHtml(pricingDisplay) : '<span class="no-restrict">&mdash;</span>'}</td>
          <td>${sourceLink}</td>
        </tr>
      `;
    }).join('');
  }

  function structuredNotePriceDisplay(note) {
    const raw = String(note && note.priceText || '').trim();
    if (raw) return raw;
    const price = Number(note && note.price);
    return isFinite(price) ? price.toFixed(2) : '';
  }

  function structuredNotePricingDisplay(note) {
    const raw = String(note && note.pricing || '').trim();
    if (!raw) return '';
    const sentYear = String(note.emailSentDate || structuredNotesData?.targetDate || '').match(/^(\d{4})-/)?.[1] || '';
    return raw.replace(/\b(\d{1,2})\/(\d{1,2})(?!\/)\b/g, (_, month, day) => {
      const mm = String(Number(month)).padStart(2, '0');
      const dd = String(Number(day)).padStart(2, '0');
      return sentYear ? `${mm}/${dd}/${sentYear}` : `${mm}/${dd}`;
    });
  }

  async function loadMarketColor() {
    const body = document.getElementById('marketColorBody');
    if (!body) return;
    try {
      const res = await fetch('/api/market-color', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      marketColorData = await res.json();
    } catch (e) {
      body.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--danger)">Failed to load market color: ${escapeHtml(e.message)}</td></tr>`;
      return;
    }
    renderMarketColor();
  }

  function renderMarketColor() {
    const body = document.getElementById('marketColorBody');
    if (!body || !marketColorData) return;
    const items = Array.isArray(marketColorData.items) ? marketColorData.items : [];
    setText('marketColorStat', formatNumber(items.length));
    setText('marketColorKicker', marketColorData.updatedAt ? `Updated ${formatFullTimestamp(marketColorData.updatedAt)}` : 'No market color yet');
    setText('marketColorSub', `${formatNumber(items.length)} reference emails from the daily folder`);
    renderStatTiles('marketColorStatTiles', [
      { label: 'Items', value: formatNumber(items.length) },
      { label: 'Rates', value: formatNumber(items.filter(i => (i.tags || []).includes('rates')).length) },
      { label: 'Credit', value: formatNumber(items.filter(i => (i.tags || []).includes('credit')).length) },
      { label: 'Macro', value: formatNumber(items.filter(i => (i.tags || []).includes('macro')).length) }
    ]);
    if (!items.length) {
      body.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--text3)">No market color emails have been ingested yet.</td></tr>`;
      return;
    }
    body.innerHTML = items.map(item => {
      const source = item.sourceFile;
      const link = source ? `<a class="source-chip" href="/api/market-color/files/${encodeURIComponent(source.id)}" target="_blank" rel="noopener">eml</a>` : '<span class="no-restrict">&mdash;</span>';
      return `
        <tr>
          <td class="issuer-cell"><strong>${escapeHtml(item.subject || 'Market color')}</strong><div class="mbs-note">${escapeHtml(item.preview || '')}</div></td>
          <td>${escapeHtml(item.from || '')}</td>
          <td>${(item.tags || []).map(tag => `<span class="rank-chip">${escapeHtml(tag)}</span>`).join(' ')}</td>
          <td>${escapeHtml(item.emailDate || '')}</td>
          <td>${link}</td>
        </tr>
      `;
    }).join('');
  }

  function setupStructuredNotes() {
    const search = document.getElementById('sn-search');
    const structure = document.getElementById('sn-structure');
    if (search) {
      search.addEventListener('input', () => {
        structuredNotesFilters.search = search.value.trim();
        if (structuredNotesData) renderStructuredNotes();
      });
    }
    if (structure) {
      structure.addEventListener('change', () => {
        structuredNotesFilters.structure = structure.value;
        if (structuredNotesData) renderStructuredNotes();
      });
    }
  }

  function setupMbsCmo() {
    const byId = id => document.getElementById(id);
    const search = byId('mf-search');
    if (!search) return;

    search.addEventListener('input', () => {
      mbsCmoFilters.search = search.value.trim();
      if (mbsCmoData) renderMbsCmo();
    });
    byId('mf-source').addEventListener('change', e => {
      mbsCmoFilters.source = e.target.value;
      if (mbsCmoData) renderMbsCmo();
    });

    [
      ['mf-minYield', 'minYield', 'num'],
      ['mf-maxWal', 'maxWal', 'num'],
      ['mf-minSpread', 'minSpread', 'num'],
      ['mf-settleFrom', 'settleFrom', 'str'],
      ['mf-maturityTo', 'maturityTo', 'str']
    ].forEach(([id, key, kind]) => {
      const el = byId(id);
      el.addEventListener('input', () => {
        if (kind === 'num') {
          const v = parseFloat(el.value);
          mbsCmoFilters[key] = isNaN(v) ? null : v;
        } else {
          mbsCmoFilters[key] = el.value || null;
        }
        if (mbsCmoData) renderMbsCmo();
      });
    });

    byId('mf-reset').addEventListener('click', () => {
      mbsCmoFilters = { search: '', source: '', minYield: null, maxWal: null, minSpread: null, settleFrom: null, maturityTo: null };
      mbsCmoView = 'all';
      ['mf-search', 'mf-source', 'mf-minYield', 'mf-maxWal', 'mf-minSpread', 'mf-settleFrom', 'mf-maturityTo'].forEach(id => {
        const el = byId(id);
        if (el) el.value = '';
      });
      if (mbsCmoData) renderMbsCmo();
    });
    byId('mf-export').addEventListener('click', exportMbsCmoCsv);

    byId('mbsCmoUploadInput').addEventListener('change', e => {
      const names = [...(e.target.files || [])].map(file => file.name);
      setText('mbsCmoUploadName', names.length ? `${names.length} selected: ${names.slice(0, 2).join(', ')}${names.length > 2 ? '...' : ''}` : 'No files selected');
    });
    byId('mbsCmoUploadBtn').addEventListener('click', uploadMbsCmoFiles);

    document.querySelectorAll('#p-mbs-cmo th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (mbsCmoSort.col === col) mbsCmoSort.dir = mbsCmoSort.dir === 'asc' ? 'desc' : 'asc';
        else {
          mbsCmoSort.col = col;
          mbsCmoSort.dir = ['originalFace', 'currentFace', 'coupon', 'price', 'yield', 'wal', 'spread'].includes(col) ? 'desc' : 'asc';
        }
        document.querySelectorAll('#p-mbs-cmo th').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
        th.classList.add(mbsCmoSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
        if (mbsCmoData) renderMbsCmo();
      });
    });

    document.querySelectorAll('.mbs-cmo-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        mbsCmoView = tab.dataset.mbsCmoView || 'all';
        if (mbsCmoData) renderMbsCmo();
      });
    });
  }

  async function uploadMbsCmoFiles() {
    const input = document.getElementById('mbsCmoUploadInput');
    const status = document.getElementById('mbsCmoUploadStatus');
    const button = document.getElementById('mbsCmoUploadBtn');
    const files = [...(input.files || [])];
    if (!files.length) return showToast('Choose one or more MBS/CMO source files', true);

    const form = new FormData();
    files.forEach(file => form.append('sources', file));
    button.disabled = true;
    status.textContent = 'Uploading and parsing sources...';
    try {
      const res = await fetch('/api/mbs-cmo/upload', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      mbsCmoData = data;
      input.value = '';
      setText('mbsCmoUploadName', 'No files selected');
      status.textContent = `Added ${formatNumber(data.uploadedOffers ? data.uploadedOffers.length : 0)} modeled rows from ${formatNumber(data.uploadedSources ? data.uploadedSources.length : files.length)} sources.`;
      if (Array.isArray(data.uploadWarnings) && data.uploadWarnings.length) {
        status.textContent += ` ${data.uploadWarnings.length} warning(s).`;
      }
      renderMbsCmo();
      showToast('MBS/CMO sources uploaded');
    } catch (e) {
      status.textContent = e.message;
      showToast(e.message, true);
    } finally {
      button.disabled = false;
    }
  }

  function exportMbsCmoCsv() {
    if (!mbsCmoData) return showToast('No MBS/CMO data loaded', true);
    if (mbsCmoView === 'sources') {
      const sources = (mbsCmoData.sources || []).filter(sourceMatchesMbsCmoFilters);
      if (!sources.length) return showToast('No source files match filters', true);
      const rows = [['Filename','Type','SizeBytes','UploadedAt','FileId']];
      sources.forEach(source => {
        rows.push([
          source.filename || '',
          source.extension || '',
          source.size ?? '',
          source.uploadedAt || '',
          source.id || ''
        ]);
      });
      const stamp = (mbsCmoData.uploadedAt || 'mbs-cmo').slice(0, 10).replace(/[^a-z0-9_-]/gi, '_');
      downloadCsv(`fbbs_mbs_cmo_sources_${stamp}.csv`, rows);
      showToast(`Exported ${sources.length} MBS/CMO source rows`);
      return;
    }
    const filtered = applyMbsCmoFilters(mbsCmoData.offers || []);
    sortMbsCmoInPlace(filtered);
    if (!filtered.length) return showToast('No rows match filters', true);
    const rows = [[
      'Product','Description','CUSIP','Coupon','Price','Bid','Ask','Yield','WAL','Duration','Spread',
      'WAC','Factor','CurrentFace','OriginalFace','SettleDate','IssueDate','MaturityDate',
      'PrincipalWindow','Collateral','TopGeo','Loans','Available','SourceType','SourceFiles','Note'
    ]];
    filtered.forEach(o => {
      rows.push([
        o.productType || '', o.description || o.emailSubject || '', o.cusip || '',
        o.coupon ?? '', o.price ?? '', o.bid ?? '', o.ask ?? '', o.yield ?? '', o.wal ?? '',
        o.duration ?? '', o.spread ?? '', o.wac ?? '', o.factor ?? '', o.currentFace ?? '',
        o.originalFace ?? '', o.settleDate || '', o.issueDate || '', o.maturityDate || '',
        o.principalWindow || '', o.collateral || '', o.topGeo || '', o.loans ?? '',
        o.available || '', o.sourceType || '', (o.sourceFiles || []).map(f => f.filename).join('; '),
        o.note || ''
      ]);
    });
    const stamp = (mbsCmoData.uploadedAt || 'mbs-cmo').slice(0, 10).replace(/[^a-z0-9_-]/gi, '_');
    downloadCsv(`fbbs_mbs_cmo_${stamp}.csv`, rows);
    showToast(`Exported ${filtered.length} MBS/CMO rows`);
  }

  // ============ Admin / Audit Log ============

  // Daily Package QA — a read-only post-publish review of the current package:
  // which of the canonical slots are filled, the parsed row counts, and a few
  // sanity flags (empty required slot, parsed 0 rows, file date ≠ package date,
  // stale package). Derived entirely from the published metadata (/api/current);
  // server-side validation rules can layer on later.
  const PACKAGE_QA_SLOTS = [
    { key: 'dashboard', optional: true },
    { key: 'econ' },
    { key: 'cd', dateField: 'brokeredCdAsOfDate', count: p => (p.brokeredCdTerms || []).length, countLabel: 'terms' },
    { key: 'cdoffers', count: p => p.offeringsCount, countLabel: 'offerings' },
    { key: 'relativeValue', count: p => p.relativeValueRowsCount, countLabel: 'rows' },
    { key: 'munioffers', count: p => p.muniOfferingsCount, countLabel: 'offerings' },
    { key: 'bairdSyndicate', optional: true, note: 'folded into Muni Offerings' },
    { key: 'mmd', count: p => p.mmdCurveCount, countLabel: 'points' },
    { key: 'treasuryNotes', count: p => p.treasuryNotesCount, countLabel: 'notes' },
    { key: 'agenciesBullets', count: p => p.agencyCount, countLabel: 'offerings (combined)', dateField: 'agencyFileDate' },
    { key: 'agenciesCallables', count: p => p.agencyCount, countLabel: 'offerings (combined)', dateField: 'agencyFileDate' },
    { key: 'corporates', count: p => p.corporatesCount, countLabel: 'offerings', dateField: 'corporatesFileDate' }
  ];

  function packageQaStatusBadge(status) {
    if (status === 'ok') return '<span class="qa-badge qa-ok">&#10003; OK</span>';
    if (status === 'optional') return '<span class="qa-badge qa-optional">&mdash; optional</span>';
    if (status === 'missing') return '<span class="qa-badge qa-missing">&#10007; missing</span>';
    return '<span class="qa-badge qa-warn">&#9888; check</span>';
  }

  function goLiveBadge(state) {
    if (state === 'ok') return '<span class="qa-badge qa-ok">&#10003; Ready</span>';
    if (state === 'fail') return '<span class="qa-badge qa-missing">&#10007; Blocked</span>';
    return '<span class="qa-badge qa-warn">&#9888; Review</span>';
  }

  function goLiveCheckIcon(state) {
    if (state === 'ok') return '&#10003;';
    if (state === 'fail') return '&#10007;';
    return '&#9888;';
  }

  function goLiveSlotList(slots, emptyText) {
    const ready = (slots || []).filter(slot => slot.ready);
    if (!ready.length) return `<span class="go-live-muted">${escapeHtml(emptyText || 'None yet')}</span>`;
    return ready.map(slot => `<span class="file-chip" title="${escapeHtml(slot.filename || '')}">${escapeHtml(slot.label)}</span>`).join('');
  }

  async function loadGoLiveStatus() {
    const panel = document.getElementById('goLiveStatusPanel');
    if (!panel) return;
    try {
      const res = await fetch('/api/admin/go-live-status', { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status === 403 ? 'Admin permission required' : 'HTTP ' + res.status);
      const status = await res.json();
      const missing = status.package && Array.isArray(status.package.missingRequiredSlots)
        ? status.package.missingRequiredSlots
        : [];
      const warnings = status.package && Array.isArray(status.package.publishWarnings)
        ? status.package.publishWarnings
        : [];
      const checks = Array.isArray(status.checks) ? status.checks : [];
      const attention = checks.filter(check => check.state !== 'ok');
      const packageInfo = status.package || {};
      const dataInfo = status.data || {};
      panel.innerHTML = `
        <div class="go-live-summary go-live-${escapeHtml(status.state || 'warn')}">
          <div>
            <strong>${escapeHtml(status.state === 'ok' ? 'Ready for internal launch' : status.state === 'fail' ? 'Launch blockers remain' : 'Nearly ready')}</strong>
            <span>${escapeHtml(packageInfo.date ? `Package ${formatShortDate(packageInfo.date)}` : 'No current package date')}</span>
          </div>
          <div class="go-live-counts">
            <span>${formatNumber((status.counts && status.counts.ok) || 0)} OK</span>
            <span>${formatNumber((status.counts && status.counts.warn) || 0)} Review</span>
            <span>${formatNumber((status.counts && status.counts.fail) || 0)} Blocked</span>
          </div>
          ${goLiveBadge(status.state)}
        </div>
        <div class="go-live-grid">
          ${checks.map(check => `
            <div class="go-live-check go-live-check-${escapeHtml(check.state || 'warn')}">
              <b>${goLiveCheckIcon(check.state)}</b>
              <div>
                <strong>${escapeHtml(check.label || '')}</strong>
                <span>${escapeHtml(check.detail || '')}</span>
              </div>
            </div>
          `).join('')}
        </div>
        <div class="go-live-details">
          <div>
            <strong>Required Slots</strong>
            <p>${goLiveSlotList(packageInfo.requiredSlots, 'No required slots filled')}</p>
          </div>
          <div>
            <strong>Optional Slots</strong>
            <p>${goLiveSlotList(packageInfo.optionalSlots, 'Optional slots not published')}</p>
          </div>
          <div>
            <strong>Data Imports</strong>
            <p>
              <span class="file-chip">Bank data ${dataInfo.bankData && dataInfo.bankData.latestPeriod ? escapeHtml(dataInfo.bankData.latestPeriod) : 'pending'}</span>
              <span class="file-chip">Account status ${dataInfo.accountStatuses && dataInfo.accountStatuses.available ? 'loaded' : 'pending'}</span>
              <span class="file-chip">Bond accounting ${dataInfo.bondAccounting && dataInfo.bondAccounting.available ? 'loaded' : 'pending'}</span>
            </p>
          </div>
        </div>
        ${(missing.length || warnings.length || attention.length) ? `
          <div class="go-live-attention">
            <strong>Attention Items</strong>
            ${missing.map(slot => `<div><span>Missing</span>${escapeHtml(slot.label || slot.key)}</div>`).join('')}
            ${warnings.slice(0, 8).map(w => `<div><span>${escapeHtml(DOC_TYPES[w.slot] ? DOC_TYPES[w.slot].label : w.slot || 'Warning')}</span>${escapeHtml(w.text || '')}</div>`).join('')}
            ${warnings.length > 8 ? `<em>${warnings.length - 8} more warning${warnings.length - 8 === 1 ? '' : 's'} in the audit log.</em>` : ''}
          </div>
        ` : ''}
      `;
    } catch (err) {
      panel.innerHTML = `<div class="go-live-error">Could not load launch status: ${escapeHtml(err.message)}</div>`;
    }
  }

  async function renderPackageQa() {
    const body = document.getElementById('packageQaBody');
    if (!body) return;
    // Refresh so QA reflects the most recent publish; fall back to cache on error.
    try {
      const res = await fetch('/api/current', { cache: 'no-store' });
      if (res.ok) currentPackage = await res.json();
    } catch (e) { /* use cached currentPackage */ }
    const pkg = currentPackage || {};
    let latestAudit = null;
    try {
      const auditRes = await fetch('/api/audit-log?limit=25', { cache: 'no-store' });
      if (auditRes.ok) {
        const entries = await auditRes.json();
        latestAudit = (Array.isArray(entries) ? entries : [])
          .find(entry => String(entry.packageDate || '').slice(0, 10) === String(pkg.date || '').slice(0, 10)) || null;
      }
    } catch (e) { /* audit details are supplemental */ }
    const today = new Date().toISOString().slice(0, 10);

    const rows = PACKAGE_QA_SLOTS.map(slot => {
      const meta = DOC_TYPES[slot.key] || { label: slot.key, ext: '' };
      const filename = pkg[slot.key] || '';
      const filled = !!filename;
      const count = filled && slot.count ? slot.count(pkg) : null;
      const fileDate = slot.dateField ? pkg[slot.dateField] : null;
      const issues = [];
      let status = 'ok';
      if (!filled) {
        status = slot.optional ? 'optional' : 'missing';
        if (!slot.optional) issues.push('Slot is empty');
      } else {
        if (slot.count && (count == null || count === 0)) {
          status = 'warn';
          issues.push('Filled but parsed 0 ' + (slot.countLabel || 'rows'));
        }
        // Compare as YYYY-MM-DD so an ISO timestamp vs a plain date doesn't
        // trip a false "file date ≠ package date" flag.
        const fileDay = String(fileDate || '').slice(0, 10);
        const pkgDay = String(pkg.date || '').slice(0, 10);
        if (fileDay && pkgDay && fileDay !== pkgDay) {
          if (status === 'ok') status = 'warn';
          issues.push('File date ' + fileDay + ' ≠ package date ' + pkgDay);
        }
      }
      return { slot, meta, filename, filled, count, fileDate, status, issues };
    });

    const required = rows.filter(r => !r.slot.optional);
    const filledRequired = required.filter(r => r.filled).length;
    const warnCount = rows.filter(r => r.status === 'warn').length;
    const missingCount = rows.filter(r => r.status === 'missing').length;
    const publishWarnings = [];
    if (latestAudit && Array.isArray(latestAudit.warnings)) {
      latestAudit.warnings.forEach(w => {
        if (w) publishWarnings.push({ slot: 'Publish', text: String(w) });
      });
    }
    const parserWarnings = latestAudit && latestAudit.parserWarnings && typeof latestAudit.parserWarnings === 'object'
      ? latestAudit.parserWarnings
      : {};
    Object.entries(parserWarnings).forEach(([slot, warnings]) => {
      (Array.isArray(warnings) ? warnings : []).forEach(w => {
        if (w) publishWarnings.push({ slot, text: String(w) });
      });
    });
    setText('packageQaStat', `${filledRequired}/${required.length}`);

    const banners = [];
    if (!pkg.date) {
      banners.push({ level: 'warn', text: 'No package has been published yet.' });
    } else {
      if (pkg.date < today) {
        const days = Math.round((Date.parse(today) - Date.parse(pkg.date)) / 86400000);
        banners.push({ level: 'info', text: `Package is dated ${pkg.date} — ${days} day${days === 1 ? '' : 's'} old.` });
      }
      if (missingCount) banners.push({ level: 'warn', text: `${missingCount} required slot${missingCount === 1 ? '' : 's'} empty.` });
      if (warnCount) banners.push({ level: 'warn', text: `${warnCount} slot${warnCount === 1 ? '' : 's'} with a data-quality flag — see the table.` });
      if (publishWarnings.length) banners.push({ level: 'warn', text: `${publishWarnings.length} publish/parser warning${publishWarnings.length === 1 ? '' : 's'} from the latest audit entry.` });
      if (!missingCount && !warnCount && !publishWarnings.length) banners.push({ level: 'ok', text: 'All required slots filled and row counts look sane.' });
    }

    body.innerHTML = `
      <div class="qa-meta">
        <div><span class="qa-meta-lbl">Package date</span><strong>${escapeHtml(pkg.date || '—')}</strong></div>
        <div><span class="qa-meta-lbl">Published</span><strong>${pkg.publishedAt ? escapeHtml(formatImportedDate(pkg.publishedAt)) : '—'}</strong></div>
        <div><span class="qa-meta-lbl">Published by</span><strong>${escapeHtml(pkg.publishedBy || '—')}</strong></div>
      </div>
      ${banners.map(b => `<div class="qa-banner qa-banner-${b.level}">${escapeHtml(b.text)}</div>`).join('')}
      ${publishWarnings.length ? `
        <div class="qa-warning-list">
          <strong>Latest publish warnings</strong>
          ${publishWarnings.slice(0, 12).map(w => `
            <div><span>${escapeHtml(w.slot)}</span>${escapeHtml(w.text)}</div>
          `).join('')}
          ${publishWarnings.length > 12 ? `<em>${publishWarnings.length - 12} more warning${publishWarnings.length - 12 === 1 ? '' : 's'} in Admin.</em>` : ''}
        </div>
      ` : ''}
      <table class="archive-table qa-table">
        <thead><tr>
          <th>Slot</th>
          <th style="width:70px">Type</th>
          <th style="width:110px">Status</th>
          <th style="width:150px;text-align:right">Count</th>
          <th>Source file</th>
          <th>Flags</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr class="qa-row-${r.status}">
              <td><strong>${escapeHtml(r.meta.label)}</strong></td>
              <td>${escapeHtml(r.meta.ext || '')}</td>
              <td>${packageQaStatusBadge(r.status)}</td>
              <td style="text-align:right">${r.count != null ? formatNumber(r.count) + (r.slot.countLabel ? ' <span class="qa-count-lbl">' + escapeHtml(r.slot.countLabel) + '</span>' : '') : '<span class="qa-note">—</span>'}</td>
              <td>${r.filename ? escapeHtml(r.filename) : (r.slot.note ? '<span class="qa-note">' + escapeHtml(r.slot.note) + '</span>' : '<span class="qa-note">—</span>')}</td>
              <td>${r.issues.length ? '<span class="qa-issue">' + r.issues.map(escapeHtml).join('; ') + '</span>' : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div class="legend-box"><strong>Note:</strong> Read-only review derived from the published package metadata (<code>/api/current</code>). Counts come from each slot's parsed JSON; optional slots (dashboard, Baird Syndicate) don't count against completeness.</div>
    `;
  }

  async function loadAuditLog() {
    const body = document.getElementById('adminBody');
    const stat = document.getElementById('adminStat');
    loadGoLiveStatus();
    try {
      const res = await fetch('/api/audit-log', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const entries = await res.json();
      stat.textContent = entries.length;

      if (entries.length === 0) {
        body.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text3)">
          No publishes recorded yet.
        </td></tr>`;
        return;
      }

      body.innerHTML = entries.map(e => {
        const files = Array.isArray(e.files)
          ? e.files.map(f => `<span class="file-chip" title="${formatSize(f.size)}">${escapeHtml(f.type)}</span>`).join('')
          : '';
        const warnings = Array.isArray(e.warnings) && e.warnings.length
          ? `<div class="admin-warnings">${e.warnings.map(w => `&#9888; ${escapeHtml(w)}`).join('<br>')}</div>`
          : '<div class="admin-clean">No warnings</div>';
        const cdCount = e.offeringsCount != null ? e.offeringsCount : '—';
        const muniCount = e.muniOfferingsCount != null ? e.muniOfferingsCount : '—';
        const agencyCountCell = e.agencyCount != null ? e.agencyCount : '—';
        const corpCountCell = e.corporatesCount != null ? e.corporatesCount : '—';
        const actor = e.actorDisplay || e.actorUsername || '';
        return `
          <tr>
            <td>${formatFullTimestamp(e.at)}</td>
            <td class="arch-date-cell">${formatShortDate(e.packageDate)}</td>
            <td>${escapeHtml(e.publishedBy || '—')}</td>
            <td>${actor ? escapeHtml(actor) : '<span class="qa-note">legacy</span>'}</td>
            <td>${files}${warnings}</td>
            <td style="text-align:right">${cdCount}</td>
            <td style="text-align:right">${muniCount}</td>
            <td style="text-align:right">${agencyCountCell}</td>
            <td style="text-align:right">${corpCountCell}</td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.error('Failed to load audit log:', err);
      body.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--danger)">
        Failed to load audit log: ${escapeHtml(err.message)}
      </td></tr>`;
    }
  }

  function formatFullTimestamp(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit'
      });
    } catch (e) { return iso; }
  }

  function formatFileSize(bytes) {
    const size = Number(bytes);
    if (!isFinite(size) || size < 0) return '—';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  // ============ Home polish (sticky-nav shadow + scroll fade-in) ============

  function setupHomePolish() {
    const topStrip = document.querySelector('.top-strip');
    if (topStrip) {
      const onScroll = () => {
        topStrip.classList.toggle('scrolled', window.scrollY > 4);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }

    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const targets = document.querySelectorAll('[data-reveal]');
    if (reduceMotion || !('IntersectionObserver' in window)) {
      targets.forEach(el => el.classList.add('in-view'));
      return;
    }
    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    targets.forEach(el => observer.observe(el));

    // Jump-bar shortcuts: "/" from a non-typing context, or Cmd/Ctrl+K anywhere.
    const jumpInput = document.getElementById('navSearchInput');
    if (jumpInput) {
      document.addEventListener('keydown', (event) => {
        const cmdK = (event.metaKey || event.ctrlKey) && !event.altKey
          && (event.key === 'k' || event.key === 'K');
        if (cmdK) {
          event.preventDefault();
          jumpInput.focus();
          jumpInput.select();
          return;
        }
        if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
        const t = event.target;
        const tag = t && t.tagName;
        const typingInField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable);
        if (typingInField) return;
        event.preventDefault();
        jumpInput.focus();
        jumpInput.select();
      });
    }
  }

  // ============ Init ============

  function renderHomeShowcase(pkg) {
    pkg = pkg || {};
    const snapshot = buildMarketSnapshot(pkg);

    const numEl = document.getElementById('showcasePrimaryValue');
    if (numEl) numEl.textContent = snapshot.primaryValue;
    const labelEl = document.getElementById('showcasePrimaryLabel');
    if (labelEl) labelEl.textContent = snapshot.primaryLabel;
    const subEl = document.getElementById('showcaseSnapshotSub');
    if (subEl) subEl.textContent = snapshot.subText;

    const metaEl = document.getElementById('showcasePackageMeta');
    if (metaEl) {
      const parts = [];
      if (pkg.date) parts.push(`<span><strong>Date</strong>${escapeHtml(formatShortDate(pkg.date))}</span>`);
      const filled = packageUploadedCount(pkg);
      if (filled) parts.push(`<span><strong>Slots</strong>${filled} of ${TOTAL_SLOTS}</span>`);
      if (pkg.publishedAt) parts.push(`<span><strong>Published</strong>${escapeHtml(formatImportedDate(pkg.publishedAt))}</span>`);
      if (parts.length) {
        metaEl.innerHTML = parts.join('');
        metaEl.hidden = false;
      } else {
        metaEl.hidden = true;
        metaEl.innerHTML = '';
      }
    }

    const dateEl = document.getElementById('marketSnapshotDate');
    if (dateEl) dateEl.textContent = snapshot.dateLabel;
    const statusEl = document.getElementById('marketSnapshotStatus');
    if (statusEl) statusEl.textContent = snapshot.statusLabel;
    const metricsEl = document.getElementById('marketSnapshotMetrics');
    if (metricsEl) {
      metricsEl.innerHTML = snapshot.metrics.length
        ? snapshot.metrics.map(snapshotMetricHtml).join('')
        : '<div class="sticky-bars-empty">Awaiting today’s package&hellip;</div>';
    }
    renderMarketSnapshotCurve(snapshot.curve);
    renderSnapshotStepMetrics(snapshot);

    const footEl = document.getElementById('showcaseMarketFoot');
    if (footEl) {
      footEl.textContent = snapshot.footText;
    }
  }

  function buildMarketSnapshot(pkg) {
    const econ = economicUpdateData || {};
    const treasuries = econ.treasuries || [];
    const marketRates = econ.marketRates || [];
    const marketRows = econ.marketData || [];
    const cds = marketData.cds || [];
    const treasuryNotes = marketData.treasuryNotes || [];
    const munis = marketData.munis || [];
    const agencies = marketData.agencies || [];
    const corporates = marketData.corporates || [];
    const totalOfferings = [pkg.treasuryNotesCount, pkg.offeringsCount, pkg.muniOfferingsCount, pkg.agencyCount, pkg.corporatesCount]
      .reduce((sum, n) => sum + (typeof n === 'number' ? n : 0), 0);

    const two = treasuries.find(row => row.tenor === '2YR');
    const ten = treasuries.find(row => row.tenor === '10YR');
    const sofr = marketRates.find(row => row.label === 'SOFR');
    const prime = marketRates.find(row => row.label === 'Prime Rate');
    const vix = marketRows.find(row => row.label === 'VIX');
    const spx = marketRows.find(row => row.label === 'SPX') || marketRows.find(row => row.label === 'S&P 500');
    const brokered12 = (pkg.brokeredCdTerms || []).find(term => term.months === 12);
    const brokered3 = (pkg.brokeredCdTerms || []).find(term => term.months === 3);
    const highestCdRate = maxValue(cds.map(o => o.rate));
    const avgAgencyYtm = average(agencies.map(o => o.ytm));
    const avgCorpYtm = average(corporates.map(o => o.ytm));
    const curveSlope = two && ten ? ten.yield - two.yield : null;
    const filled = packageUploadedCount(pkg);
    const nextRelease = (econ.releases || [])[0];

    const primaryValue = ten ? formatPercentTile(ten.yield, 3)
      : (highestCdRate != null ? formatPercentTile(highestCdRate, 2)
        : (totalOfferings > 0 ? formatNumber(totalOfferings) : '—'));
    const primaryLabel = ten ? '10Y Treasury sets the tone.'
      : (highestCdRate != null ? 'Top CD offering in the package.' : 'Daily market read.');

    const metrics = [
      {
        label: '2Y Treasury',
        value: two ? formatPercentTile(two.yield, 3) : '—',
        detail: two ? formatMarketChange(two.dailyChange, 3) : 'change —',
        tone: two ? changeClass(two.dailyChange) : ''
      },
      {
        label: '10Y Treasury',
        value: ten ? formatPercentTile(ten.yield, 3) : '—',
        detail: ten ? formatMarketChange(ten.dailyChange, 3) : 'change —',
        tone: ten ? changeClass(ten.dailyChange) : ''
      },
      {
        label: 'Brokered 12M',
        value: brokered12 ? formatPercentTile(brokered12.mid, 3) : '—',
        detail: brokered12 ? `range ${formatPercentTile(brokered12.low, 2)}-${formatPercentTile(brokered12.high, 2)}` : 'rate sheet pending'
      },
      {
        label: 'Top CD Offer',
        value: highestCdRate != null ? formatPercentTile(highestCdRate, 2) : '—',
        detail: cds.length ? `${formatNumber(cds.length)} CDs searchable` : 'offerings pending'
      },
      {
        label: 'Inventory',
        value: totalOfferings > 0 ? formatNumber(totalOfferings) : '—',
        detail: totalOfferings > 0 ? 'treasuries, CDs, munis, agencies, corporates' : 'upload offerings'
      },
      {
        label: 'Volatility',
        value: formatMarketValue(vix),
        detail: vix ? formatMarketChange(vix.change, 2) : 'VIX pending',
        tone: vix ? changeClass(vix.change) : ''
      }
    ];

    const subText = ten || two
      ? `Rates from the Economic Update, funding from the CD sheet, and ${totalOfferings > 0 ? formatNumber(totalOfferings) : 'available'} offerings from today's inventory uploads.`
      : 'Upload the Economic Update, Relative Value, CD rate sheet, and offerings files to populate the daily market read.';

    return {
      primaryValue,
      primaryLabel,
      subText,
      dateLabel: pkg.date ? formatShortDate(pkg.date) : 'Awaiting package',
      statusLabel: filled === TOTAL_SLOTS ? 'Complete' : `${filled}/${TOTAL_SLOTS} files`,
      footText: pkg.publishedAt ? `Published ${formatImportedDate(pkg.publishedAt)}` : 'From the most recent published package',
      metrics,
      curve: treasuries,
      ratesMetrics: [
        `2s/10s ${curveSlope != null ? curveSlope.toFixed(3) + '%' : '—'}`,
        `SOFR ${formatMarketValue(sofr)}`,
        `Prime ${formatMarketValue(prime)}`,
        `SPX ${formatMarketValue(spx)}`
      ],
      fundingMetrics: [
        `3M all-in ${brokered3 ? formatPercentTile(brokered3.mid, 3) : '—'}`,
        `12M all-in ${brokered12 ? formatPercentTile(brokered12.mid, 3) : '—'}`,
        `Top CD ${highestCdRate != null ? formatPercentTile(highestCdRate, 2) : '—'}`,
        `Common term ${mostCommonTerm(cds)}`
      ],
      inventoryMetrics: [
        `${formatNumber(treasuryNotes.length)} treasuries`,
        `${formatNumber(cds.length)} CDs`,
        `${formatNumber(munis.length)} munis`,
        `${formatNumber(agencies.length)} agencies`,
        `${formatNumber(corporates.length)} corporates`
      ],
      contextMetrics: [
        pkg.relativeValue ? 'Relative Value loaded' : 'Relative Value pending',
        pkg.treasuryNotes ? 'Treasury Notes loaded' : 'Treasury Notes pending',
        nextRelease ? `Next: ${nextRelease.event || 'calendar event'}` : 'Calendar pending',
        `Agency YTM ${formatPercentTile(avgAgencyYtm, 3)}`,
        `Corp YTM ${formatPercentTile(avgCorpYtm, 3)}`
      ]
    };
  }

  function snapshotMetricHtml(metric) {
    return `
      <div class="snapshot-metric">
        <span>${escapeHtml(metric.label)}</span>
        <strong>${escapeHtml(metric.value)}</strong>
        <em class="${escapeHtml(metric.tone || '')}">${escapeHtml(metric.detail || '')}</em>
      </div>
    `;
  }

  function renderMarketSnapshotCurve(treasuries) {
    const target = document.getElementById('marketSnapshotCurve');
    if (!target) return;
    const rows = (treasuries || []).filter(row => row.yield != null && !isNaN(row.yield));
    if (!rows.length) {
      target.innerHTML = '<div class="sticky-bars-empty">Treasury curve appears after Economic Update upload.</div>';
      return;
    }
    const yields = rows.map(row => row.yield);
    const min = Math.min.apply(null, yields);
    const max = Math.max.apply(null, yields);
    const range = Math.max(max - min, 0.01);
    target.innerHTML = rows.map(row => {
      const height = 20 + ((row.yield - min) / range) * 72;
      return `
        <div class="snapshot-curve-bar" title="${escapeHtml(row.label)} ${escapeHtml(formatPercentTile(row.yield, 3))}">
          <span style="height:${height.toFixed(1)}%"></span>
          <strong>${escapeHtml(formatPercentTile(row.yield, 2))}</strong>
          <em>${escapeHtml(row.tenor || row.label)}</em>
        </div>
      `;
    }).join('');
  }

  function renderSnapshotStepMetrics(snapshot) {
    [
      ['snapshotRatesMetrics', snapshot.ratesMetrics],
      ['snapshotFundingMetrics', snapshot.fundingMetrics],
      ['snapshotInventoryMetrics', snapshot.inventoryMetrics],
      ['snapshotContextMetrics', snapshot.contextMetrics]
    ].forEach(([id, items]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = (items || []).map(item => `<span>${escapeHtml(item)}</span>`).join('');
    });
  }

  function setupGlobalErrorLogging() {
    if (window.__fbbsGlobalErrorLoggingBound) return;
    window.__fbbsGlobalErrorLoggingBound = true;
    window.addEventListener('error', event => {
      console.error('[FBBS portal error]', event.message || event.error || event);
    });
    window.addEventListener('unhandledrejection', event => {
      console.error('[FBBS portal promise rejection]', event.reason || event);
    });
  }

  function init() {
    setupGlobalErrorLogging();
    setHeaderDate();
    loadCurrent();
    loadStrategyNotifications();
    loadBankStatus();
    loadArchive();
    setupRepPicker();
    setupMyWorkClicks();
    setupSavedViews();
    loadMe();
    setupHome();
    setupHomePolish();
    setupUpload();
    setupGlobalSearch();
    setupCdCostCalculator();
    setupCdOpportunityTool();
    setupEconomicMarketTool();
    setupNavSearch();
    setupMarketNav();
    setupChartTooltips();
    setupCdRecap();
    setupTreasuryFilters();
    setupOfferingsFilters();
    setupMuniFilters();
    setupAgencyFilters();
    setupCorpFilters();
    setupMbsCmo();
    setupStructuredNotes();
    setupBankSearch();
    setupReports();
    setupStrategies();
    setupPeerGroups();
    setupCommissionControls();
    setupSidebar();

    // Respect a hash on initial load (e.g. bookmarked /#archive)
    const target = parseHashTarget(window.location.hash || '#home').page;
    goTo(target, { updateHash: false });
  }

  function setupSidebar() {
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (!toggle || !sidebar || !backdrop) return;
    const closeDrawer = () => {
      sidebar.classList.remove('open');
      backdrop.classList.remove('show');
    };

    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      backdrop.classList.toggle('show');
    });
    backdrop.addEventListener('click', closeDrawer);
    // On mobile, tapping a nav link should close the sidebar
    document.querySelectorAll('.sidebar .nav-link').forEach(link => {
      link.addEventListener('click', () => {
        if (window.innerWidth <= 900) {
          closeDrawer();
        }
      });
    });

    // The "Acting as" rep picker lives in the top strip on desktop, but the
    // top-strip links (and the picker with them) are hidden at ≤900px. Move the
    // single #repPicker node into the drawer on mobile so reps can still switch,
    // and back to the top strip on wider viewports. Reparenting preserves the
    // element's event listeners; the picker was the last child of
    // .top-strip-links, so re-appending restores its original position.
    placeRepPicker();
    let repPlacementMobile = window.innerWidth <= 900;
    window.addEventListener('resize', () => {
      const isMobile = window.innerWidth <= 900;
      if (!isMobile) closeDrawer();
      if (isMobile !== repPlacementMobile) {
        repPlacementMobile = isMobile;
        placeRepPicker();
      }
    });
  }

  function placeRepPicker() {
    const picker = document.getElementById('repPicker');
    if (!picker) return;
    const onMobile = window.innerWidth <= 900;
    const slot = document.getElementById('sidebarRepSlot');
    const topLinks = document.querySelector('.top-strip-links');
    const target = onMobile ? slot : topLinks;
    if (!target || picker.parentElement === target) return;
    closeRepPanel();
    target.appendChild(picker);
  }

  // ============ US Bank Map ============

  const MAPS_NUMERIC_OPS = ['>', '>=', '=', '<=', '<', '!='];
  const MAPS_TEXT_OPS = ['contains', 'equals'];
  const MAPS_SECURITIES_TO_ASSETS_FIELD = {
    key: 'securitiesToAssets',
    label: 'Securities / Assets (%)',
    type: 'percent',
    section: 'balanceSheet'
  };

  let mapsState = {
    loaded: false,
    loading: false,
    banks: [],
    fields: [],
    fieldByKey: {},
    stateCounts: {},
    latestPeriod: '',
    mappedCount: 0,
    selectedStates: new Set(),
    selectedStatuses: new Set(),
    selectedBankId: '',
    detailDismissed: false,
    selectedLocationKey: '',
    selectedLocationIndex: 0,
    visibleBanks: [],
    search: '',
    areaSearch: { query: '', radiusMiles: 50, center: null, label: '', matchedCount: 0 },
    locationFilter: null,
    territory: { owner: '', minAssets: '', maxAssets: '', sort: 'opportunity' },
    advanced: [],
    viewport: null,
    mapRevision: 0
  };

  function mapsFieldFilterType(def) {
    if (!def) return 'text';
    return (def.type === 'money' || def.type === 'percent' || def.type === 'percentOf' || def.type === 'number')
      ? 'number' : 'text';
  }

  function mapsRenderPeerDeltas(bank) {
    const peer = mapsState.peerComparison;
    if (!peer || !peer.byKey) return '';
    const entries = [];
    for (const [metricKey, info] of Object.entries(peer.byKey)) {
      const delta = bank ? bank[`peerDelta_${metricKey}`] : null;
      const def = mapsState.fieldByKey[metricKey];
      // Prefer the projected map field label, then the server-supplied
      // BANK_FIELDS/peer label, and only fall back to the raw key as a last
      // resort. Strip the trailing unit suffix ("($000)", "(%)") either way.
      const rawLabel = (def && def.label) || info.label || metricKey;
      const label = String(rawLabel).replace(/\s*\(.*?\)\s*$/, '').trim();
      let signal = 'neutral';
      let arrow = '·';
      let deltaText = '—';
      if (Number.isFinite(Number(delta))) {
        const d = Number(delta);
        if (Math.abs(d) >= 0.01 && info.higherIsBetter !== null && info.higherIsBetter !== undefined) {
          signal = (info.higherIsBetter ? d > 0 : d < 0) ? 'favorable' : 'watch';
        } else if (Math.abs(d) >= 0.01) {
          signal = 'neutral';
        }
        arrow = d > 0 ? '▲' : (d < 0 ? '▼' : '·');
        deltaText = `${arrow} ${Math.abs(d).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
      }
      entries.push({ label, deltaText, signal, peerValue: info.peerValue });
    }
    if (!entries.length) return '';
    const periodLine = peer.period
      ? `Peer ${escapeHtml(peer.period)}${peer.bankPeriod && peer.bankPeriod !== peer.period ? ` · bank latest ${escapeHtml(peer.bankPeriod)}` : ''}`
      : '';
    return `
      <div class="maps-peer-block">
        <div class="maps-peer-head">
          <strong>vs Peer</strong>
          <span>${periodLine}</span>
        </div>
        <div class="maps-peer-grid">
          ${entries.map(e => `
            <div class="maps-peer-chip maps-peer-${e.signal}">
              <span class="maps-peer-label">${escapeHtml(e.label)}</span>
              <span class="maps-peer-delta">${escapeHtml(e.deltaText)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function mapsFormatValue(value, def) {
    if (value == null || value === '') return '';
    if (!def) return String(value);
    if (def.type === 'money') {
      const mm = Number(value) / 1000;
      if (!Number.isFinite(mm)) return '';
      if (Math.abs(mm) >= 1000) return mm.toLocaleString(undefined, { maximumFractionDigits: 0 });
      return mm.toLocaleString(undefined, { maximumFractionDigits: 1 });
    }
    if (def.type === 'percent' || def.type === 'percentOf') {
      const n = Number(value);
      return Number.isFinite(n) ? `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}%` : '';
    }
    if (def.type === 'number') {
      const n = Number(value);
      return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '';
    }
    return String(value);
  }

  function mapsNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(String(value).replace(/,/g, '').replace(/%/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }

  function mapsSecuritiesToAssets(bank) {
    const direct = mapsNumber(bank && bank.securitiesToAssets);
    if (direct !== null) return direct;
    const totalAssets = mapsNumber(bank && bank.totalAssets);
    if (!totalAssets) return null;
    const afs = mapsNumber(bank && bank.afsTotal);
    const htm = mapsNumber(bank && bank.htmTotal);
    if (afs === null && htm === null) return null;
    return ((afs || 0) + (htm || 0)) * 100 / totalAssets;
  }

  function mapsBankListName(bank) {
    const displayName = String(bank && bank.displayName || '').trim();
    const city = String(bank && bank.city || '').trim();
    const state = String(bank && bank.state || '').trim();
    if (!displayName) return '';
    if (city && state) {
      const suffix = `, ${city}, ${state}`;
      if (displayName.toLowerCase().endsWith(suffix.toLowerCase())) {
        return displayName.slice(0, -suffix.length).trim();
      }
    }
    return displayName;
  }

  function mapsAccountStatusLabel(bank) {
    const status = bank && (
      bank.accountStatusLabel ||
      (bank.accountStatus && bank.accountStatus.status)
    );
    return status || 'Open';
  }

  function mapsStatusSlug(value) {
    return String(value || 'Open').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  function mapsStatusColor(value) {
    const status = mapsStatusSlug(value);
    if (status === 'client') return '#ba2f25';
    if (status === 'prospect') return '#1597c7';
    if (status === 'open') return '#7c3bc7';
    if (status === 'watchlist') return '#6b3d2e';
    if (status === 'dormant') return '#6D7A72';
    return '#345F4A';
  }

  function mapsHasCoords(bank) {
    const lat = Number(bank && bank.latitude);
    const lon = Number(bank && bank.longitude);
    // Treat the (0,0) sentinel — a bank whose ZIP had no centroid, which
    // arrives as null and coerces to 0 — as unmapped. Otherwise it drops a
    // phantom pin in the Atlantic and stretches the fit-to-results bounds
    // across the hemisphere, so a selected state never appears to zoom in.
    return Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0);
  }

  function mapsCoverageOwner(bank) {
    return String(bank && bank.accountStatus && bank.accountStatus.owner || '').trim();
  }

  function mapsAssetsMm(bank) {
    const raw = mapsNumber(bank && bank.totalAssets);
    return raw === null ? null : raw / 1000;
  }

  function mapsOpportunityScore(bank) {
    let score = 0;
    const status = mapsAccountStatusLabel(bank);
    if (status === 'Prospect') score += 45;
    else if (status === 'Open') score += 34;
    else if (status === 'Watchlist') score += 18;
    else if (status === 'Client') score += 8;
    const assets = mapsAssetsMm(bank);
    if (assets !== null) score += Math.min(28, Math.log10(Math.max(assets, 1)) * 7);
    const securities = mapsNumber(mapsSecuritiesToAssets(bank));
    if (securities !== null) score += Math.min(16, securities / 4);
    const loansToDeposits = mapsNumber(bank && bank.loansToDeposits);
    if (loansToDeposits !== null && loansToDeposits < 75) score += Math.min(10, (75 - loansToDeposits) / 5);
    const owner = mapsCoverageOwner(bank);
    if (!owner) score += 4;
    return score;
  }

  function mapsSortRows(rows, area) {
    const sort = mapsState.territory.sort || 'opportunity';
    rows.sort((a, b) => {
      if (area) return (a._mapsAreaDistance || 0) - (b._mapsAreaDistance || 0) || (Number(b.totalAssets) || 0) - (Number(a.totalAssets) || 0);
      if (sort === 'name') return mapsBankListName(a).localeCompare(mapsBankListName(b));
      if (sort === 'securities') return (mapsNumber(mapsSecuritiesToAssets(b)) || 0) - (mapsNumber(mapsSecuritiesToAssets(a)) || 0);
      if (sort === 'loans') return (mapsNumber(b.loansToDeposits) || 0) - (mapsNumber(a.loansToDeposits) || 0);
      if (sort === 'opportunity') return mapsOpportunityScore(b) - mapsOpportunityScore(a) || (Number(b.totalAssets) || 0) - (Number(a.totalAssets) || 0);
      return (Number(b.totalAssets) || 0) - (Number(a.totalAssets) || 0);
    });
  }

  function mapsOwnerOptions() {
    const owners = new Set();
    mapsState.banks.forEach(bank => {
      const owner = mapsCoverageOwner(bank);
      if (owner) owners.add(owner);
    });
    return Array.from(owners).sort((a, b) => a.localeCompare(b));
  }

  function mapsLocationFilterMatches(bank) {
    const filter = mapsState.locationFilter;
    if (!filter) return true;
    if (filter.type === 'city') {
      return String(bank.city || '').trim().toLowerCase() === filter.value &&
        String(bank.state || '').trim().toLowerCase() === filter.state;
    }
    if (filter.type === 'county') {
      const county = String(bank.county || '').replace(/,\s*[A-Z]{2}.*$/, '').trim().toLowerCase();
      return county === filter.value && String(bank.state || '').trim().toLowerCase() === filter.state;
    }
    return true;
  }

  function mapsGroupByLocation(rows, type) {
    const byKey = new Map();
    rows.forEach(bank => {
      const state = String(bank.state || '').trim();
      const rawName = type === 'county'
        ? String(bank.county || '').replace(/,\s*[A-Z]{2}.*$/, '').trim()
        : String(bank.city || '').trim();
      if (!rawName || !state) return;
      const key = `${type}|${rawName.toLowerCase()}|${state.toLowerCase()}`;
      const current = byKey.get(key) || { type, value: rawName.toLowerCase(), state: state.toLowerCase(), label: `${rawName}, ${state}`, count: 0, assets: 0 };
      current.count += 1;
      current.assets += Number(bank.totalAssets) || 0;
      byKey.set(key, current);
    });
    return Array.from(byKey.values())
      .sort((a, b) => b.count - a.count || b.assets - a.assets || a.label.localeCompare(b.label))
      .slice(0, 5);
  }

  function mapsSetViewport(viewport) {
    mapsState.viewport = viewport ? {
      scale: viewport.scale,
      center: { lon: viewport.center.lon, lat: viewport.center.lat }
    } : null;
  }

  function mapsFitResults() {
    mapsSetViewport(null);
    mapsState.mapRevision += 1;
    applyMapsFilters();
  }

  function mapsResetUsView() {
    mapsSetViewport({ scale: 1, center: { lon: MAPS_DEFAULT_CENTER.lon, lat: MAPS_DEFAULT_CENTER.lat } });
    mapsState.mapRevision += 1;
    applyMapsFilters();
  }

  function mapsNormalizeAreaText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/\b(county|parish|city|town|municipality)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function mapsDistanceMiles(aLat, aLon, bLat, bLon) {
    const lat1 = Number(aLat);
    const lon1 = Number(aLon);
    const lat2 = Number(bLat);
    const lon2 = Number(bLon);
    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Infinity;
    const toRad = deg => deg * Math.PI / 180;
    const r = 3958.8;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function mapsAreaCandidateScore(bank, query) {
    if (!query || !mapsHasCoords(bank)) return 0;
    const city = mapsNormalizeAreaText(bank.city);
    const county = mapsNormalizeAreaText(String(bank.county || '').replace(/,.*/, ''));
    const state = mapsNormalizeAreaText(bank.state);
    const zip = mapsNormalizeAreaText(bank.zip5 || bank.zip);
    const location = [city, county, state, zip].filter(Boolean).join(' ');
    if (city === query) return 90;
    if (county === query) return 80;
    if (`${city} ${state}` === query || `${county} ${state}` === query) return 95;
    if (city && query.length >= 4 && (query.includes(city) || city.includes(query))) return 72;
    if (county && query.length >= 4 && (query.includes(county) || county.includes(query))) return 70;
    if (query.length >= 4 && location.includes(query)) return 55;
    if (query.includes(location) && location.length >= 3) return 45;
    return 0;
  }

  function mapsAreaAnchorKey(bank, query) {
    const city = mapsNormalizeAreaText(bank && bank.city);
    const county = mapsNormalizeAreaText(String(bank && bank.county || '').replace(/,.*/, ''));
    const state = mapsNormalizeAreaText(bank && bank.state);
    if (city && `${city} ${state}` === query) return `city|${city}|${state}`;
    if (county && `${county} ${state}` === query) return `county|${county}|${state}`;
    if (county && (county === query || query.includes(county))) return `county|${county}|${state}`;
    if (city && (city === query || query.includes(city))) return `city|${city}|${state}`;
    return `location|${city}|${county}|${state}|${mapsNormalizeAreaText(bank && (bank.zip5 || bank.zip))}`;
  }

  function mapsAreaAnchorLabel(bank, key) {
    const parts = String(key || '').split('|');
    if (parts[0] === 'county') {
      const county = String(bank && bank.county || '').replace(/,\s*[A-Z]{2}.*$/, '').trim();
      return [county ? `${county} County` : '', bank && bank.state].filter(Boolean).join(' · ');
    }
    return [bank && bank.city, bank && bank.state].filter(Boolean).join(' · ');
  }

  function mapsAreaIsActive() {
    return Boolean(mapsState.areaSearch && mapsState.areaSearch.center);
  }

  function mapsApplyAreaSearch() {
    const input = document.getElementById('mapsAreaSearchBox');
    const radius = document.getElementById('mapsAreaRadius');
    const raw = input ? input.value : '';
    const query = mapsNormalizeAreaText(raw);
    if (!query || query.length < 2) {
      showToast('Enter a town or county to search the map', true);
      return;
    }
    const candidates = mapsState.banks
      .map(bank => ({ bank, score: mapsAreaCandidateScore(bank, query) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || mapsBankListName(a.bank).localeCompare(mapsBankListName(b.bank)));
    if (!candidates.length) {
      mapsState.areaSearch = { query: raw.trim(), radiusMiles: Number(radius && radius.value) || 50, center: null, label: '', matchedCount: 0 };
      mapsState.locationFilter = null;
      renderMapsAreaStatus();
      applyMapsFilters();
      showToast('No matching town or county found in the bank data', true);
      return;
    }
    const bestScore = candidates[0].score;
    const clustered = new Map();
    candidates.filter(item => item.score === bestScore).forEach(item => {
      const key = mapsAreaAnchorKey(item.bank, query);
      if (!clustered.has(key)) clustered.set(key, { key, items: [], assets: 0 });
      const group = clustered.get(key);
      group.items.push(item);
      group.assets += Number(item.bank.totalAssets) || 0;
    });
    const bestCluster = Array.from(clustered.values())
      .sort((a, b) => b.items.length - a.items.length || b.assets - a.assets || a.key.localeCompare(b.key))[0];
    const anchors = bestCluster ? bestCluster.items : candidates.filter(item => item.score === bestScore);
    const lat = anchors.reduce((sum, item) => sum + Number(item.bank.latitude), 0) / anchors.length;
    const lon = anchors.reduce((sum, item) => sum + Number(item.bank.longitude), 0) / anchors.length;
    const first = anchors[0].bank;
    const label = mapsAreaAnchorLabel(first, bestCluster && bestCluster.key) || raw.trim();
    mapsState.areaSearch = {
      query: raw.trim(),
      radiusMiles: Number(radius && radius.value) || 50,
      center: { lat, lon },
      label,
      matchedCount: anchors.length
    };
    mapsState.selectedStates.clear();
    mapsState.locationFilter = null;
    mapsState.selectedBankId = '';
    mapsState.selectedLocationKey = '';
    mapsSetViewport(null);
    mapsState.mapRevision += 1;
    renderMapsStateChips();
    renderMapsAreaStatus();
    applyMapsFilters();
  }

  function mapsClearAreaSearch() {
    mapsState.areaSearch = { query: '', radiusMiles: 50, center: null, label: '', matchedCount: 0 };
    mapsState.locationFilter = null;
    const input = document.getElementById('mapsAreaSearchBox');
    const radius = document.getElementById('mapsAreaRadius');
    if (input) input.value = '';
    if (radius) radius.value = '50';
    mapsSetViewport(null);
    mapsState.mapRevision += 1;
    renderMapsAreaStatus();
    applyMapsFilters();
  }

  function renderMapsAreaStatus() {
    const el = document.getElementById('mapsAreaStatus');
    if (!el) return;
    if (!mapsState.areaSearch || !mapsState.areaSearch.query) {
      el.textContent = 'Search a town or county to find nearby banks.';
      return;
    }
    if (!mapsAreaIsActive()) {
      el.textContent = `No town or county matched "${mapsState.areaSearch.query}".`;
      return;
    }
    el.textContent = `${mapsState.areaSearch.label || mapsState.areaSearch.query} · within ${formatNumber(mapsState.areaSearch.radiusMiles)} miles`;
  }

  function mapsLocationKey(bank) {
    if (!bank) return '';
    return bank.locationKey || [bank.zip5 || bank.zip, bank.city, bank.county, bank.state].filter(Boolean).join('|');
  }

  function mapsLocationGroups(banks) {
    const groups = new Map();
    for (const bank of banks || []) {
      if (!mapsHasCoords(bank)) continue;
      const key = mapsLocationKey(bank) || `${bank.latitude},${bank.longitude}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          lat: 0,
          lon: 0,
          label: bank.locationLabel || [bank.city, bank.county, bank.state, bank.zip5 || bank.zip].filter(Boolean).join(' · '),
          banks: []
        });
      }
      const group = groups.get(key);
      group.lat += Number(bank.latitude);
      group.lon += Number(bank.longitude);
      group.banks.push(bank);
    }
    return Array.from(groups.values()).map(group => {
      group.banks.sort((a, b) => mapsBankListName(a).localeCompare(mapsBankListName(b)));
      if (group.banks.length) {
        group.lat = group.lat / group.banks.length;
        group.lon = group.lon / group.banks.length;
      }
      return group;
    });
  }

  function mapsSelectedLocationGroup() {
    const bank = mapsFindBank(mapsState.selectedBankId);
    const key = mapsState.selectedLocationKey || mapsLocationKey(bank);
    if (!key) return null;
    return mapsLocationGroups(mapsState.visibleBanks.length ? mapsState.visibleBanks : mapsState.banks)
      .find(group => group.key === key) || null;
  }

  function mapsSelectBank(bank, group) {
    if (!bank) return;
    mapsState.detailDismissed = false;
    mapsState.selectedBankId = String(bank.id || '');
    mapsState.selectedLocationKey = group ? group.key : mapsLocationKey(bank);
    const peers = group ? group.banks : mapsLocationGroups(mapsState.visibleBanks).find(g => g.key === mapsState.selectedLocationKey)?.banks;
    const idx = peers ? peers.findIndex(peer => String(peer.id || '') === String(bank.id || '')) : -1;
    mapsState.selectedLocationIndex = idx >= 0 ? idx : 0;
  }

  // Default geo extent (continental US) and per-state zoom helpers.
  const MAPS_DEFAULT_LONAXIS = [-126, -66];
  const MAPS_DEFAULT_LATAXIS = [24, 50];
  // Center the default albers-usa view resolves to at scale 1 (whole US).
  const MAPS_DEFAULT_CENTER = { lon: -96.6, lat: 38.7 };

  function mapsComputeView(rows) {
    if (!rows || !rows.length) return null;
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity, count = 0;
    for (const r of rows) {
      if (!mapsHasCoords(r)) continue;
      const lat = Number(r.latitude);
      const lon = Number(r.longitude);
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      count += 1;
    }
    if (!count) return null;
    const center = { lon: (minLon + maxLon) / 2, lat: (minLat + maxLat) / 2 };
    // Zoom the albers-usa projection with projection.scale (1 = whole US) +
    // center, NOT lon/lat range. Range-based zoom mis-projects the scattergeo
    // bank pins off-frame when tight (a 50-mile area search would lose every
    // pin); scale+center keeps them correctly placed. ~26° lat / ~60° lon is
    // the span the default view shows at scale 1; the +pad/floor keeps a tight
    // selection (single bank, small area) from zooming in uncomfortably far.
    const effLat = Math.max((maxLat - minLat) + 1.4, 1.4);
    const effLon = Math.max((maxLon - minLon) + 2.2, 2.2);
    // Cap at 6 so a single-bank or very tight result keeps regional context
    // (a lone pin in a featureless green field is disorienting) rather than
    // zooming all the way in.
    const scale = Math.max(1, Math.min(6, Math.min(26 / effLat, 60 / effLon)));
    return { center, scale };
  }

  function mapsFindBank(id) {
    const key = String(id || '');
    return mapsState.banks.find(bank => String(bank.id || '') === key) || null;
  }

  function mapsCompareNumeric(value, def) {
    if (value == null || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    if (def && def.type === 'money') return n / 1000;
    return n;
  }

  async function loadMaps() {
    const subtitle = document.getElementById('mapsSubtitle');
    if (mapsState.loading) return;
    if (mapsState.loaded) {
      renderMapsView();
      return;
    }
    mapsState.loading = true;
    if (subtitle) subtitle.textContent = 'Loading bank tear sheet data…';
    mapsSetLoadingState(true);
    try {
      const res = await fetch('/api/banks/map', { cache: 'no-store' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Bank tear sheet data not available yet.');
      }
      const data = await res.json();
      mapsState.banks = Array.isArray(data.banks)
        ? data.banks.map(bank => ({ ...bank, securitiesToAssets: mapsSecuritiesToAssets(bank) }))
        : [];
      mapsState.fields = (Array.isArray(data.fields) ? data.fields : []).map(f => ({
        ...f,
        label: f.type === 'money' ? f.label.replace('($000)', '($MM)') : f.label
      }));
      if (!mapsState.fields.some(f => f.key === 'securitiesToAssets')) {
        mapsState.fields.push({ ...MAPS_SECURITIES_TO_ASSETS_FIELD });
      }
      mapsState.fieldByKey = {};
      for (const f of mapsState.fields) mapsState.fieldByKey[f.key] = f;
      mapsState.stateCounts = data.stateCounts || {};
      mapsState.latestPeriod = data.latestPeriod || '';
      mapsState.mappedCount = data.mappedCount || mapsState.banks.filter(mapsHasCoords).length;
      mapsState.peerComparison = data.peerComparison || null;
    mapsState.loaded = true;
      mapsBindHandlers();
      renderMapsOwnerOptions();
      renderMapsView();
    } catch (err) {
      if (subtitle) subtitle.textContent = err.message || 'Failed to load bank data';
      const body = document.getElementById('mapsBankBody');
      if (body) body.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text3)">${escapeHtml(err.message || 'Failed to load')}</td></tr>`;
    } finally {
      mapsState.loading = false;
      mapsSetLoadingState(false);
    }
  }

  function mapsSetLoadingState(isLoading) {
    const plot = document.getElementById('mapsPlot');
    const body = document.getElementById('mapsBankBody');
    const count = document.getElementById('mapsRowCount');
    if (plot) {
      let overlay = plot.querySelector('.maps-loading-overlay');
      if (isLoading && !overlay) {
        overlay = document.createElement('div');
        overlay.className = 'maps-loading-overlay';
        overlay.innerHTML = '<div class="loading-spinner" aria-hidden="true"></div><span>Loading bank map&hellip;</span>';
        plot.appendChild(overlay);
      } else if (!isLoading && overlay) {
        overlay.remove();
      }
    }
    if (body && isLoading) {
      body.innerHTML = '<tr><td colspan="8"><div class="table-loading"><div class="loading-spinner" aria-hidden="true"></div><span>Loading banks&hellip;</span></div></td></tr>';
    }
    if (count && isLoading) count.textContent = 'Loading…';
  }

  function renderMapsSubtitle() {
    const subtitle = document.getElementById('mapsSubtitle');
    if (!subtitle) return;
    const hasStates = mapsState.selectedStates.size > 0;
    const hasArea = mapsAreaIsActive();
    const tail = hasStates
      ? 'Drag or scroll the map freely, then click a pin for status and key stats.'
      : hasArea
        ? 'Showing banks around the searched muni deal area.'
      : 'Use Add State or area search to drop pins, then drag the map freely.';
    subtitle.textContent = mapsState.latestPeriod
      ? `Period ${mapsState.latestPeriod} · ${mapsState.banks.length.toLocaleString()} banks · ${mapsState.mappedCount.toLocaleString()} mapped · ${tail}`
      : `${mapsState.banks.length.toLocaleString()} banks · ${tail}`;
  }

  function renderMapsView() {
    const countEl = document.getElementById('mapsBankCount');
    if (countEl) countEl.textContent = mapsState.banks.length.toLocaleString();
    renderMapsSubtitle();
    renderMapsStateChips();
    renderMapsStatusFilters();
    renderMapsAreaStatus();
    renderMapsStateSummary();
    renderMapsDrilldown(mapsState.visibleBanks.length ? mapsState.visibleBanks : mapsState.banks);
    renderMapsDetailPanel();
    applyMapsFilters();
  }

  function renderMapsMarkerMap(rows, options = {}) {
    const plotId = options.plotId || 'mapsPlot';
    const isFull = options.full === true;
    const el = document.getElementById(plotId);
    if (!el) return;
    if (typeof Plotly === 'undefined') {
      // Vendored Plotly didn't load — don't leave a blank square; the filterable
      // bank list below is still fully usable.
      el.innerHTML = '<div class="bank-search-empty">The map library could not be loaded. The bank list below is still available — reload the page to retry the map.</div>';
      return;
    }
    if (Plotly.setPlotConfig) Plotly.setPlotConfig({ topojsonURL: '/vendor/' });
    if (!el.style.position) el.style.position = 'relative';
    const showMarkers = mapsState.selectedStates.size > 0 || mapsAreaIsActive() || (mapsState.search || '').trim().length >= 2;
    const groups = showMarkers ? mapsLocationGroups(rows) : [];
    const selectedKey = mapsState.selectedLocationKey;
    const area = mapsAreaIsActive() ? mapsState.areaSearch : null;
    const stateEntries = Object.entries(mapsState.stateCounts).sort();
    const portalScale = [
      [0.00, '#f6faf7'],
      [0.25, '#dbe6df'],
      [0.50, '#b8cebe'],
      [0.75, '#6f8f7d'],
      [1.00, '#003f2a']
    ];
    const figData = [{
      type: 'choropleth',
      locationmode: 'USA-states',
      locations: stateEntries.map(([state]) => state),
      z: stateEntries.map(([, count]) => count),
      colorscale: portalScale,
      showscale: false,
      hovertemplate: '<b>%{location}</b><br>Total banks: %{z:,.0f}<br><span style="font-size:11px">Click to drop pins</span><extra></extra>',
      marker: {
        line: {
          color: stateEntries.map(([state]) => mapsState.selectedStates.has(state) ? '#003f2a' : '#ffffff'),
          width: stateEntries.map(([state]) => mapsState.selectedStates.has(state) ? 2.4 : 0.7)
        }
      },
      opacity: showMarkers ? 0.55 : 0.85
    }];
    if (area) {
      const ring = [];
      const lat = area.center.lat;
      const lon = area.center.lon;
      const radius = area.radiusMiles || 50;
      for (let deg = 0; deg <= 360; deg += 8) {
        const rad = deg * Math.PI / 180;
        const dLat = radius / 69;
        const dLon = radius / Math.max(1, 69 * Math.cos(lat * Math.PI / 180));
        ring.push({ lat: lat + Math.sin(rad) * dLat, lon: lon + Math.cos(rad) * dLon });
      }
      figData.push({
        type: 'scattergeo',
        mode: 'lines',
        lat: ring.map(point => point.lat),
        lon: ring.map(point => point.lon),
        hoverinfo: 'skip',
        line: { color: '#8257d6', width: 2, dash: 'dot' },
        showlegend: false
      }, {
        type: 'scattergeo',
        mode: 'markers',
        lat: [lat],
        lon: [lon],
        hovertemplate: `<b>${escapeHtml(area.label || area.query)}</b><br>${formatNumber(radius)} mile search area<extra></extra>`,
        marker: {
          color: '#ffffff',
          line: { color: '#8257d6', width: 3 },
          size: 18,
          symbol: 'star'
        },
        showlegend: false
      });
    }
    figData.push({
      type: 'scattergeo',
      mode: 'markers+text',
      lat: groups.map(group => group.lat),
      lon: groups.map(group => group.lon),
      text: groups.map(group => group.banks.length > 1 ? String(group.banks.length) : ''),
      textposition: 'top center',
      textfont: { color: '#101715', size: 11, family: 'inherit' },
      customdata: groups.map(group => group.key),
      hovertemplate: groups.map(group => {
        const first = group.banks[0];
        const bankLabel = group.banks.length === 1 ? mapsBankListName(first) : `${group.banks.length} banks`;
        return `<b>${escapeHtml(bankLabel)}</b><br>${escapeHtml(group.label || '')}<extra></extra>`;
      }),
      marker: {
        size: groups.map(group => group.key === selectedKey ? 24 : Math.min(28, 14 + Math.sqrt(group.banks.length) * 3.5)),
        color: groups.map(group => mapsStatusColor(mapsAccountStatusLabel(group.banks[0]))),
        opacity: 0.9,
        line: {
          color: '#ffffff',
          width: groups.map(group => group.key === selectedKey ? 4 : 2)
        },
        symbol: groups.map(group => group.banks.length > 1 ? 'circle' : 'circle')
      },
      showlegend: false
    });
    const viewport = mapsState.viewport;
    const autoView = showMarkers ? mapsComputeView(rows) : null;
    const view = viewport || autoView;
    const geoCenter = view && view.center ? view.center : MAPS_DEFAULT_CENTER;
    const geoScale = view && view.scale ? view.scale : 1;
    const layout = {
      geo: {
        scope: 'usa',
        projection: { type: 'albers usa', scale: geoScale },
        center: { lon: geoCenter.lon, lat: geoCenter.lat },
        showlakes: true,
        lakecolor: '#b7e1e6',
        showocean: true,
        oceancolor: '#a7dce8',
        bgcolor: 'rgba(0,0,0,0)',
        landcolor: '#dff1de',
        countrycolor: '#94afa2',
        subunitcolor: '#94afa2',
        showcountries: true,
        showsubunits: true,
        lonaxis: { range: MAPS_DEFAULT_LONAXIS.slice() },
        lataxis: { range: MAPS_DEFAULT_LATAXIS.slice() }
      },
      font: { family: 'inherit', color: '#1f2925' },
      margin: { t: 10, r: 10, b: 10, l: 10 },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      uirevision: `maps-${mapsState.mapRevision}`
    };
    Plotly.react(el, figData, layout, { responsive: true, displaylogo: false, scrollZoom: true, modeBarButtonsToRemove: ['select2d', 'lasso2d'] }).then(() => {
      if (el.dataset.mapsClickBound) return;
      el.dataset.mapsClickBound = '1';
      el.on('plotly_click', (data) => {
        if (!data || !data.points || !data.points.length) return;
        const point = data.points[0];
        if (point.fullData && point.fullData.type === 'choropleth') {
          const st = point.location;
          if (!st) return;
          if (mapsState.selectedStates.has(st)) mapsState.selectedStates.delete(st);
          else mapsState.selectedStates.add(st);
          mapsState.areaSearch = { query: '', radiusMiles: 50, center: null, label: '', matchedCount: 0 };
          mapsState.locationFilter = null;
          const areaInput = document.getElementById('mapsAreaSearchBox');
          if (areaInput) areaInput.value = '';
          mapsSetViewport(null);
          mapsState.mapRevision += 1;
          renderMapsStateChips();
          renderMapsAreaStatus();
          applyMapsFilters();
          return;
        }
        const key = point.customdata;
        if (!key) return;
        const group = mapsLocationGroups(mapsState.visibleBanks).find(item => item.key === key);
        if (!group || !group.banks.length) return;
        const nextIndex = mapsState.selectedLocationKey === key
          ? (mapsState.selectedLocationIndex + 1) % group.banks.length
          : 0;
        mapsState.selectedLocationKey = key;
        mapsState.selectedLocationIndex = nextIndex;
        mapsState.selectedBankId = String(group.banks[nextIndex].id || '');
        mapsState.detailDismissed = false;
        applyMapsFilters();
        // Clicking a pin used to force the full-screen modal open. Now that
        // the inline map is full-size, just surface the bank in the detail
        // panel and bring it into view — Full View stays one button away.
        if (!isFull) {
          const panel = document.getElementById('mapsDetailPanel');
          if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    });
  }

  function renderMapsStateChips() {
    const chipsEl = document.getElementById('mapsStateChips');
    const select = document.getElementById('mapsStateSelect');
    if (select) {
      const states = Object.entries(mapsState.stateCounts).sort((a, b) => a[0].localeCompare(b[0]));
      select.innerHTML = '<option value="">Add State...</option>' + states.map(([state, count]) =>
        `<option value="${escapeHtml(state)}"${mapsState.selectedStates.has(state) ? ' disabled' : ''}>${escapeHtml(state)} (${formatNumber(count)})</option>`
      ).join('');
      select.value = '';
    }
    if (!chipsEl) return;
    if (mapsState.selectedStates.size === 0) {
      chipsEl.innerHTML = '<span class="maps-chip">All</span>';
      return;
    }
    const html = Array.from(mapsState.selectedStates).sort().map(st =>
      `<span class="maps-chip"><span>${escapeHtml(st)}</span><span class="x" data-maps-remove-state="${escapeHtml(st)}" title="Remove">×</span></span>`
    ).join('');
    chipsEl.innerHTML = html;
  }

  function renderMapsOwnerOptions() {
    const select = document.getElementById('mapsOwnerSelect');
    if (!select) return;
    const current = mapsState.territory.owner || '';
    select.innerHTML = '<option value="">All owners</option>' + mapsOwnerOptions().map(owner =>
      `<option value="${escapeHtml(owner)}"${owner === current ? ' selected' : ''}>${escapeHtml(owner)}</option>`
    ).join('');
  }

  function renderMapsStateSummary() {
    const el = document.getElementById('mapsStateSummary');
    if (!el) return;
    const states = Array.from(mapsState.selectedStates).sort();
    const area = mapsAreaIsActive() ? mapsState.areaSearch : null;
    const owner = mapsState.territory.owner;
    const filter = mapsState.locationFilter;
    const parts = [];
    if (states.length) parts.push(`<strong>${escapeHtml(states.join(', '))}</strong><span>Click a selected state again to remove it.</span>`);
    else if (area) parts.push(`<strong>${escapeHtml(area.label || area.query)}</strong><span>${formatNumber(area.radiusMiles)} mile area search.</span>`);
    else parts.push('<strong>All states</strong><span>Click any state to drop pins and focus the list.</span>');
    if (filter) parts.push(`<span>Drilldown: ${escapeHtml(filter.label)}</span>`);
    if (owner) parts.push(`<span>Owner: ${escapeHtml(owner)}</span>`);
    if (mapsState.selectedStatuses.size) parts.push(`<span>Status: ${escapeHtml(Array.from(mapsState.selectedStatuses).sort().join(', '))}</span>`);
    el.innerHTML = parts.join('');
  }

  function renderMapsDrilldown(rows) {
    const el = document.getElementById('mapsStateDrilldown');
    if (!el) return;
    const shouldShow = mapsState.selectedStates.size > 0 || mapsAreaIsActive() || mapsState.locationFilter;
    if (!shouldShow) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    const cities = mapsGroupByLocation(rows, 'city');
    const counties = mapsGroupByLocation(rows, 'county');
    const section = (title, items) => `
      <div class="maps-drilldown-block">
        <strong>${escapeHtml(title)}</strong>
        <div class="maps-drilldown-list">
          ${items.map(item => {
            const active = mapsState.locationFilter &&
              mapsState.locationFilter.type === item.type &&
              mapsState.locationFilter.value === item.value &&
              mapsState.locationFilter.state === item.state;
            return `<button type="button" class="maps-drilldown-item${active ? ' active' : ''}"
                data-maps-drill-type="${escapeHtml(item.type)}"
                data-maps-drill-value="${escapeHtml(item.value)}"
                data-maps-drill-state="${escapeHtml(item.state)}"
                data-maps-drill-label="${escapeHtml(item.label)}">
              <span>${escapeHtml(item.label)}</span>
              <em>${formatNumber(item.count)}</em>
            </button>`;
          }).join('') || '<span class="maps-tip">No locations in the current result.</span>'}
        </div>
      </div>`;
    el.hidden = false;
    el.innerHTML = section('Top cities', cities) + section('Top counties', counties);
    el.querySelectorAll('[data-maps-drill-type]').forEach(btn => {
      btn.addEventListener('click', event => {
        event.stopPropagation();
        mapsApplyLocationDrilldown(btn);
      });
    });
  }

  function mapsApplyLocationDrilldown(btn) {
    if (!btn) return;
    const same = mapsState.locationFilter &&
      mapsState.locationFilter.type === btn.dataset.mapsDrillType &&
      mapsState.locationFilter.value === btn.dataset.mapsDrillValue &&
      mapsState.locationFilter.state === btn.dataset.mapsDrillState;
    mapsState.locationFilter = same ? null : {
      type: btn.dataset.mapsDrillType,
      value: btn.dataset.mapsDrillValue,
      state: btn.dataset.mapsDrillState,
      label: btn.dataset.mapsDrillLabel || ''
    };
    mapsState.selectedBankId = '';
    applyMapsFilters();
  }

  function mapsStatusCounts() {
    const counts = {};
    for (const bank of mapsState.banks) {
      const status = mapsAccountStatusLabel(bank);
      counts[status] = (counts[status] || 0) + 1;
    }
    return counts;
  }

  const MAPS_STATUS_ORDER = ['Open', 'Prospect', 'Client', 'Watchlist', 'Dormant'];

  function renderMapsStatusFilters() {
    const el = document.getElementById('mapsLegend');
    if (!el) return;
    const counts = mapsStatusCounts();
    // Show every status that actually appears in the data (canonical order
    // first, then any unexpected ones) so the legend stays complete and
    // filterable as Watchlist/Dormant banks get tagged.
    const statuses = MAPS_STATUS_ORDER.filter(s => counts[s]);
    Object.keys(counts).forEach(s => { if (!statuses.includes(s)) statuses.push(s); });
    if (!statuses.length) statuses.push('Open', 'Prospect', 'Client');
    const allActive = mapsState.selectedStatuses.size === 0;
    const total = mapsState.banks.length;
    el.innerHTML = [
      `<div class="maps-legend-title">Status</div>`,
      `<button type="button" class="maps-legend-item${allActive ? ' active' : ''}" data-maps-status-filter="">
         <span class="maps-legend-dot maps-legend-dot-all" aria-hidden="true"></span>
         <span class="maps-legend-label">All</span>
         <span class="maps-legend-count">${formatNumber(total)}</span>
       </button>`,
      ...statuses.map(status => {
        const active = mapsState.selectedStatuses.has(status);
        const count = counts[status] || 0;
        return `<button type="button" class="maps-legend-item maps-status-${escapeHtml(mapsStatusSlug(status))}${active ? ' active' : ''}" data-maps-status-filter="${escapeHtml(status)}">
          <span class="maps-legend-dot" style="background:${mapsStatusColor(status)}" aria-hidden="true"></span>
          <span class="maps-legend-label">${escapeHtml(status)}</span>
          <span class="maps-legend-count">${formatNumber(count)}</span>
        </button>`;
      })
    ].join('');
  }

  function rowMatchesAdvanced(bank) {
    if (!mapsState.advanced.length) return true;
    for (const cond of mapsState.advanced) {
      const def = mapsState.fieldByKey[cond.field];
      if (!def) continue;
      const val = bank[cond.field];
      if (mapsFieldFilterType(def) === 'number') {
        const lhs = mapsCompareNumeric(val, def);
        const rhs = Number(String(cond.value).replace(/,/g, '').replace(/%/g, ''));
        if (lhs == null || !Number.isFinite(rhs)) return false;
        switch (cond.op) {
          case '>': if (!(lhs > rhs)) return false; break;
          case '>=': if (!(lhs >= rhs)) return false; break;
          case '<': if (!(lhs < rhs)) return false; break;
          case '<=': if (!(lhs <= rhs)) return false; break;
          case '=': if (!(lhs === rhs)) return false; break;
          case '!=': if (!(lhs !== rhs)) return false; break;
          default: return false;
        }
      } else {
        const lhs = String(val || '').toLowerCase();
        const rhs = String(cond.value || '').toLowerCase();
        if (cond.op === 'equals') { if (lhs !== rhs) return false; }
        else if (cond.op === 'contains') { if (!lhs.includes(rhs)) return false; }
        else return false;
      }
    }
    return true;
  }

  function applyMapsFilters() {
    const body = document.getElementById('mapsBankBody');
    const rowCountEl = document.getElementById('mapsRowCount');
    if (!body) return;
    const q = (mapsState.search || '').toLowerCase().trim();
    const sel = mapsState.selectedStates;
    const statusSel = mapsState.selectedStatuses;
    const area = mapsAreaIsActive() ? mapsState.areaSearch : null;
    const ownerFilter = mapsState.territory.owner;
    const minAssets = mapsNumber(mapsState.territory.minAssets);
    const maxAssets = mapsNumber(mapsState.territory.maxAssets);
    const rows = [];
    const drilldownRows = [];
    for (const b of mapsState.banks) {
      if (sel.size > 0 && !sel.has(b.state)) continue;
      if (statusSel.size > 0 && !statusSel.has(mapsAccountStatusLabel(b))) continue;
      if (ownerFilter && mapsCoverageOwner(b) !== ownerFilter) continue;
      const assetsMm = mapsAssetsMm(b);
      if (minAssets !== null && (assetsMm === null || assetsMm < minAssets)) continue;
      if (maxAssets !== null && (assetsMm === null || assetsMm > maxAssets)) continue;
      if (area) {
        const distance = mapsDistanceMiles(area.center.lat, area.center.lon, b.latitude, b.longitude);
        if (distance > area.radiusMiles) continue;
        b._mapsAreaDistance = distance;
      } else if (b._mapsAreaDistance !== undefined) {
        delete b._mapsAreaDistance;
      }
      if (q) {
        const hay = (String(b.displayName || '') + ' ' + String(b.certNumber || '') + ' ' + String(b.city || '') + ' ' + String(b.county || '') + ' ' + String(b.state || '') + ' ' + mapsAccountStatusLabel(b)).toLowerCase();
        if (!hay.includes(q)) continue;
      }
      if (!rowMatchesAdvanced(b)) continue;
      drilldownRows.push(b);
      if (!mapsLocationFilterMatches(b)) continue;
      rows.push(b);
    }
    mapsSortRows(rows, area);
    mapsState.visibleBanks = rows;
    renderMapsSubtitle();
    renderMapsStateSummary();
    renderMapsDrilldown(drilldownRows);
    const limit = 1000;
    const shown = rows.slice(0, limit);
    const visibleIds = new Set(shown.map(row => String(row.id || '')));
    if (!shown.length) mapsState.selectedBankId = '';
    else if (!mapsState.detailDismissed && !visibleIds.has(String(mapsState.selectedBankId || ''))) {
      // Pre-fill the panel with the top result, but only until the user has
      // explicitly closed it — otherwise "Close" just re-selects this bank
      // and the panel can never be dismissed.
      mapsSelectBank(shown[0], mapsLocationGroups(rows).find(group => group.key === mapsLocationKey(shown[0])));
    } else if (mapsState.detailDismissed && !visibleIds.has(String(mapsState.selectedBankId || ''))) {
      mapsState.selectedBankId = '';
    }
    renderMapsMarkerMap(rows);
    const assetsDef = mapsState.fieldByKey.totalAssets;
    const securitiesToAssetsDef = mapsState.fieldByKey.securitiesToAssets || MAPS_SECURITIES_TO_ASSETS_FIELD;
    body.innerHTML = shown.map(b => `
      <tr data-maps-bankid="${escapeHtml(b.id)}" class="${String(b.id || '') === String(mapsState.selectedBankId || '') ? 'maps-row-selected' : ''}">
        <td><button type="button" class="maps-bank-link" data-maps-bank-preview="${escapeHtml(b.id)}">${escapeHtml(mapsBankListName(b))}</button></td>
        <td>${escapeHtml(b.certNumber || '')}</td>
        <td>${escapeHtml(b.city || '')}</td>
        <td>${escapeHtml(b.state || '')}</td>
        <td><span class="maps-status-pill maps-status-${escapeHtml(mapsStatusSlug(mapsAccountStatusLabel(b)))}">${escapeHtml(mapsAccountStatusLabel(b))}</span></td>
        <td class="num">${escapeHtml(Math.round(mapsOpportunityScore(b)))}</td>
        <td class="num">${escapeHtml(mapsFormatValue(b.totalAssets, assetsDef))}</td>
        <td class="num">${escapeHtml(mapsFormatValue(mapsSecuritiesToAssets(b), securitiesToAssetsDef))}</td>
      </tr>
    `).join('') || '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text3)">No banks match the current filters</td></tr>';
    // Selection happens on explicit click only, via the delegated handler
    // bound once on #mapsBankBody. Earlier this also fired on pointerdown and
    // focus, which meant closing the detail panel could immediately re-select
    // a bank when focus shifted back into the table ("Close" jumped to
    // another bank instead of dismissing).
    if (rowCountEl) {
      const total = rows.length.toLocaleString();
      const areaPrefix = area ? `within ${formatNumber(area.radiusMiles)} mi · ` : '';
      rowCountEl.textContent = rows.length > limit
        ? `${areaPrefix}${shown.length.toLocaleString()} of ${total} bank(s) shown (top by assets)`
        : `${areaPrefix}${total} bank(s) shown`;
    }
    if (area) {
      const areaStatus = document.getElementById('mapsAreaStatus');
      if (areaStatus) {
        areaStatus.textContent = `${area.label || area.query} · ${formatNumber(rows.length)} banks within ${formatNumber(area.radiusMiles)} miles`;
      }
    }
    renderMapsActiveFilters();
    renderMapsDetailPanel();
    renderMapsFullView();
  }

  function mapsDetailMetric(label, value) {
    return `
      <div class="maps-detail-metric">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value || '')}</strong>
      </div>
    `;
  }

  function renderMapsDetailPanel() {
    const panel = document.getElementById('mapsDetailPanel');
    if (!panel) return;
    const bank = mapsFindBank(mapsState.selectedBankId);
    if (!bank) {
      panel.hidden = false;
      panel.classList.remove('maps-detail-populated');
      panel.innerHTML = '<div class="maps-detail-empty">Select a bank row to preview key map metrics.</div>';
      return;
    }
    panel.classList.add('maps-detail-populated');
    const assetsDef = mapsState.fieldByKey.totalAssets;
    const depositsDef = mapsState.fieldByKey.totalDeposits;
    const loansToDepositsDef = mapsState.fieldByKey.loansToDeposits;
    const securitiesToAssetsDef = mapsState.fieldByKey.securitiesToAssets || MAPS_SECURITIES_TO_ASSETS_FIELD;
    const status = mapsAccountStatusLabel(bank);
    const group = mapsSelectedLocationGroup();
    const groupBanks = group && group.banks && group.banks.length ? group.banks : [bank];
    const groupIndex = Math.max(0, groupBanks.findIndex(peer => String(peer.id || '') === String(bank.id || '')));
    mapsState.selectedLocationIndex = groupIndex;
    const accountStatus = bank.accountStatus || {};
    const locationLine = [bank.address, bank.city, bank.state, bank.zip5 || bank.zip].filter(Boolean).join(', ');
    panel.hidden = false;
    panel.innerHTML = `
      <div class="maps-detail-head">
        <div>
          <span class="maps-detail-status"><span class="maps-detail-status-dot" style="background:${mapsStatusColor(status)}"></span>Status: ${escapeHtml(status)}</span>
          <h4>${escapeHtml(mapsBankListName(bank))}</h4>
          <p>${escapeHtml(locationLine || [bank.city, bank.state, bank.certNumber ? `FDIC ${bank.certNumber}` : ''].filter(Boolean).join(' - '))}</p>
        </div>
        <button type="button" class="small-btn" id="mapsDetailClose">Close</button>
      </div>
      ${groupBanks.length > 1 ? `
        <div class="maps-detail-carousel">
          <button type="button" class="small-btn" id="mapsPrevOverlap" aria-label="Previous bank at this marker">&lt;</button>
          <span>${formatNumber(groupIndex + 1)} of ${formatNumber(groupBanks.length)} banks at this marker</span>
          <button type="button" class="small-btn" id="mapsNextOverlap" aria-label="Next bank at this marker">&gt;</button>
        </div>
      ` : ''}
      <div class="maps-detail-grid">
        ${mapsDetailMetric('Coverage Owner', accountStatus.owner || '')}
        ${mapsDetailMetric('Assets ($MM)', mapsFormatValue(bank.totalAssets, assetsDef))}
        ${mapsDetailMetric('Total Loans / Assets', mapsFormatValue(bank.loansToAssets, mapsState.fieldByKey.loansToAssets))}
        ${mapsDetailMetric('Securities / Assets', mapsFormatValue(mapsSecuritiesToAssets(bank), securitiesToAssetsDef))}
        ${mapsDetailMetric('Deposits ($MM)', mapsFormatValue(bank.totalDeposits, depositsDef))}
        ${mapsDetailMetric('Loans / Deposits', mapsFormatValue(bank.loansToDeposits, loansToDepositsDef))}
      </div>
      ${mapsRenderPeerDeltas(bank)}
      <div class="maps-detail-actions">
        <button type="button" class="small-btn primary" id="mapsOpenTearSheet">Open tear sheet</button>
      </div>
    `;
    const close = document.getElementById('mapsDetailClose');
    if (close) close.addEventListener('click', () => {
      mapsState.detailDismissed = true;
      mapsState.selectedBankId = '';
      applyMapsFilters();
    });
    const cycle = direction => {
      if (!group || groupBanks.length <= 1) return;
      const next = (groupIndex + direction + groupBanks.length) % groupBanks.length;
      mapsSelectBank(groupBanks[next], group);
      applyMapsFilters();
    };
    const prev = document.getElementById('mapsPrevOverlap');
    if (prev) prev.addEventListener('click', () => cycle(-1));
    const next = document.getElementById('mapsNextOverlap');
    if (next) next.addEventListener('click', () => cycle(1));
    const open = document.getElementById('mapsOpenTearSheet');
    if (open) open.addEventListener('click', () => {
      goTo('banks');
      if (typeof loadBank === 'function') loadBank(bank.id, { collapseResults: true });
    });
  }

  function renderMapsFullDetail() {
    const detail = document.getElementById('mapsFullDetail');
    if (!detail) return;
    const bank = mapsFindBank(mapsState.selectedBankId);
    if (!bank) {
      detail.innerHTML = '<div class="maps-detail-empty">Select a bank marker or row to preview tear sheet metrics.</div>';
      return;
    }
    const assetsDef = mapsState.fieldByKey.totalAssets;
    const depositsDef = mapsState.fieldByKey.totalDeposits;
    const loansToDepositsDef = mapsState.fieldByKey.loansToDeposits;
    const securitiesToAssetsDef = mapsState.fieldByKey.securitiesToAssets || MAPS_SECURITIES_TO_ASSETS_FIELD;
    const status = mapsAccountStatusLabel(bank);
    const group = mapsSelectedLocationGroup();
    const groupBanks = group && group.banks && group.banks.length ? group.banks : [bank];
    const groupIndex = Math.max(0, groupBanks.findIndex(peer => String(peer.id || '') === String(bank.id || '')));
    mapsState.selectedLocationIndex = groupIndex;
    const accountStatus = bank.accountStatus || {};
    const locationLine = [bank.address, bank.city, bank.state, bank.zip5 || bank.zip].filter(Boolean).join(', ');
    detail.innerHTML = `
      <div class="maps-detail-head">
        <div>
          <span class="maps-detail-status"><span class="maps-detail-status-dot" style="background:${mapsStatusColor(status)}"></span>Status: ${escapeHtml(status)}</span>
          <h4>${escapeHtml(mapsBankListName(bank))}</h4>
          <p>${escapeHtml(locationLine || [bank.city, bank.state, bank.certNumber ? `FDIC ${bank.certNumber}` : ''].filter(Boolean).join(' - '))}</p>
        </div>
      </div>
      ${groupBanks.length > 1 ? `
        <div class="maps-detail-carousel">
          <button type="button" class="small-btn" id="mapsFullPrevOverlap" aria-label="Previous bank at this marker">&lt;</button>
          <span>${formatNumber(groupIndex + 1)} of ${formatNumber(groupBanks.length)} banks at this marker</span>
          <button type="button" class="small-btn" id="mapsFullNextOverlap" aria-label="Next bank at this marker">&gt;</button>
        </div>
      ` : ''}
      <div class="maps-detail-grid">
        ${mapsDetailMetric('FDIC', bank.certNumber || '')}
        ${mapsDetailMetric('Coverage Owner', accountStatus.owner || '')}
        ${mapsDetailMetric('City', bank.city || '')}
        ${mapsDetailMetric('State', bank.state || '')}
        ${mapsDetailMetric('Assets ($MM)', mapsFormatValue(bank.totalAssets, assetsDef))}
        ${mapsDetailMetric('Securities / Assets', mapsFormatValue(mapsSecuritiesToAssets(bank), securitiesToAssetsDef))}
        ${mapsDetailMetric('Total Loans / Assets', mapsFormatValue(bank.loansToAssets, mapsState.fieldByKey.loansToAssets))}
        ${mapsDetailMetric('Deposits ($MM)', mapsFormatValue(bank.totalDeposits, depositsDef))}
        ${mapsDetailMetric('Loans / Deposits', mapsFormatValue(bank.loansToDeposits, loansToDepositsDef))}
      </div>
      ${mapsRenderPeerDeltas(bank)}
      <div class="maps-detail-actions">
        <button type="button" class="small-btn primary" id="mapsFullOpenTearSheet">Open tear sheet</button>
      </div>
    `;
    const cycle = direction => {
      if (!group || groupBanks.length <= 1) return;
      const next = (groupIndex + direction + groupBanks.length) % groupBanks.length;
      mapsSelectBank(groupBanks[next], group);
      applyMapsFilters();
    };
    const prev = document.getElementById('mapsFullPrevOverlap');
    if (prev) prev.addEventListener('click', () => cycle(-1));
    const next = document.getElementById('mapsFullNextOverlap');
    if (next) next.addEventListener('click', () => cycle(1));
    const open = document.getElementById('mapsFullOpenTearSheet');
    if (open) open.addEventListener('click', () => {
      closeMapsFullView();
      goTo('banks');
      if (typeof loadBank === 'function') loadBank(bank.id, { collapseResults: true });
    });
  }

  function renderMapsFullView() {
    const backdrop = document.getElementById('mapsFullBackdrop');
    if (!backdrop || backdrop.hidden) return;
    const rows = mapsState.visibleBanks.length ? mapsState.visibleBanks : mapsState.banks;
    const subtitle = document.getElementById('mapsFullSubtitle');
    if (subtitle) {
      const states = mapsState.selectedStates.size ? Array.from(mapsState.selectedStates).sort().join(', ') : 'all states';
      subtitle.textContent = `${formatNumber(rows.length)} banks shown · ${states}`;
    }
    renderMapsMarkerMap(rows, { plotId: 'mapsFullPlot', full: true });
    renderMapsFullDetail();
  }

  function openMapsFullView() {
    const backdrop = document.getElementById('mapsFullBackdrop');
    if (!backdrop) return;
    backdrop.hidden = false;
    renderMapsFullView();
    setTimeout(() => {
      if (typeof Plotly !== 'undefined') {
        const el = document.getElementById('mapsFullPlot');
        if (el && Plotly.Plots && Plotly.Plots.resize) Plotly.Plots.resize(el);
      }
    }, 50);
  }

  function closeMapsFullView() {
    const backdrop = document.getElementById('mapsFullBackdrop');
    if (backdrop) backdrop.hidden = true;
  }

  function renderMapsActiveFilters() {
    const el = document.getElementById('mapsActiveFilters');
    if (!el) return;
    const parts = mapsState.advanced.map(f => {
      const def = mapsState.fieldByKey[f.field];
      return (def ? def.label : f.field) + ' ' + f.op + ' ' + f.value;
    });
    if (mapsState.locationFilter) parts.push(`Location ${mapsState.locationFilter.label}`);
    if (mapsState.territory.owner) parts.push(`Owner ${mapsState.territory.owner}`);
    if (mapsState.territory.minAssets) parts.push(`Assets >= ${mapsState.territory.minAssets}MM`);
    if (mapsState.territory.maxAssets) parts.push(`Assets <= ${mapsState.territory.maxAssets}MM`);
    el.textContent = parts.length ? 'Active filter: ' + parts.join(' AND ') : '';
  }

  function openMapsConditionsModal() {
    const backdrop = document.getElementById('mapsModalBackdrop');
    const body = document.getElementById('mapsConditionsBody');
    if (!backdrop || !body) return;
    const defaultKey = (mapsState.fields.find(f => f.key === 'totalAssets') || mapsState.fields[0] || {}).key;
    if (mapsState.advanced.length === 0 && defaultKey) {
      mapsState.advanced.push({ field: defaultKey, op: '>', value: '' });
    }
    renderMapsConditionRows();
    backdrop.hidden = false;
  }

  function closeMapsConditionsModal() {
    const backdrop = document.getElementById('mapsModalBackdrop');
    if (backdrop) backdrop.hidden = true;
  }

  function renderMapsConditionRows() {
    const body = document.getElementById('mapsConditionsBody');
    if (!body) return;
    const allFields = mapsState.fields;
    body.innerHTML = mapsState.advanced.map((cond, idx) => {
      const def = mapsState.fieldByKey[cond.field] || allFields[0];
      const ops = mapsFieldFilterType(def) === 'number' ? MAPS_NUMERIC_OPS : MAPS_TEXT_OPS;
      const fieldOpts = allFields.map(f => `<option value="${escapeHtml(f.key)}"${def && f.key === def.key ? ' selected' : ''}>${escapeHtml(f.label)}</option>`).join('');
      const opOpts = ops.map(o => `<option value="${escapeHtml(o)}"${o === cond.op ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('');
      return `
        <div class="maps-cond" data-maps-cond-idx="${idx}">
          <select data-maps-cond-field>${fieldOpts}</select>
          <select data-maps-cond-op>${opOpts}</select>
          <input type="text" data-maps-cond-value value="${escapeHtml(String(cond.value || ''))}" placeholder="value">
          <button type="button" class="small-btn" data-maps-cond-remove>Remove</button>
        </div>
      `;
    }).join('');
  }

  function mapsBindHandlers() {
    const search = document.getElementById('mapsSearchBox');
    if (search && !search.dataset.bound) {
      let searchTimer = null;
      search.addEventListener('input', () => {
        mapsState.search = search.value;
        mapsState.locationFilter = null;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(applyMapsFilters, 160);
      });
      search.dataset.bound = '1';
    }
    const areaInput = document.getElementById('mapsAreaSearchBox');
    const areaBtn = document.getElementById('mapsAreaSearchBtn');
    const areaClear = document.getElementById('mapsAreaClearBtn');
    const areaRadius = document.getElementById('mapsAreaRadius');
    if (areaInput && !areaInput.dataset.bound) {
      areaInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          mapsApplyAreaSearch();
        }
      });
      areaInput.dataset.bound = '1';
    }
    if (areaBtn && !areaBtn.dataset.bound) {
      areaBtn.addEventListener('click', mapsApplyAreaSearch);
      areaBtn.dataset.bound = '1';
    }
    if (areaClear && !areaClear.dataset.bound) {
      areaClear.addEventListener('click', mapsClearAreaSearch);
      areaClear.dataset.bound = '1';
    }
    if (areaRadius && !areaRadius.dataset.bound) {
      areaRadius.addEventListener('change', () => {
        if (mapsAreaIsActive()) {
          mapsState.areaSearch.radiusMiles = Number(areaRadius.value) || 50;
          mapsSetViewport(null);
          mapsState.mapRevision += 1;
          renderMapsAreaStatus();
          applyMapsFilters();
        }
      });
      areaRadius.dataset.bound = '1';
    }
    const fitBtn = document.getElementById('mapsFitResultsBtn');
    if (fitBtn && !fitBtn.dataset.bound) {
      fitBtn.addEventListener('click', mapsFitResults);
      fitBtn.dataset.bound = '1';
    }
    const resetViewBtn = document.getElementById('mapsResetViewBtn');
    if (resetViewBtn && !resetViewBtn.dataset.bound) {
      resetViewBtn.addEventListener('click', mapsResetUsView);
      resetViewBtn.dataset.bound = '1';
    }
    const stateSelect = document.getElementById('mapsStateSelect');
    if (stateSelect && !stateSelect.dataset.bound) {
      stateSelect.addEventListener('change', () => {
        const state = stateSelect.value;
        if (!state) return;
        mapsState.selectedStates.add(state);
        mapsState.areaSearch = { query: '', radiusMiles: 50, center: null, label: '', matchedCount: 0 };
        mapsState.locationFilter = null;
        const areaInput = document.getElementById('mapsAreaSearchBox');
        if (areaInput) areaInput.value = '';
        mapsSetViewport(null);
        mapsState.mapRevision += 1;
        renderMapsStateChips();
        renderMapsAreaStatus();
        applyMapsFilters();
      });
      stateSelect.dataset.bound = '1';
    }
    const clearBtn = document.getElementById('mapsClearStates');
    if (clearBtn && !clearBtn.dataset.bound) {
      clearBtn.addEventListener('click', () => {
        mapsState.selectedStates.clear();
        mapsState.locationFilter = null;
        mapsSetViewport(null);
        mapsState.mapRevision += 1;
        renderMapsStateChips();
        applyMapsFilters();
      });
      clearBtn.dataset.bound = '1';
    }
    const statusFilters = document.getElementById('mapsLegend');
    if (statusFilters && !statusFilters.dataset.bound) {
      statusFilters.addEventListener('click', e => {
        const btn = e.target.closest('[data-maps-status-filter]');
        if (!btn) return;
        const status = btn.dataset.mapsStatusFilter;
        if (!status) mapsState.selectedStatuses.clear();
        else if (mapsState.selectedStatuses.has(status)) mapsState.selectedStatuses.delete(status);
        else mapsState.selectedStatuses.add(status);
        renderMapsStatusFilters();
        renderMapsStateSummary();
        applyMapsFilters();
      });
      statusFilters.dataset.bound = '1';
    }
    const ownerSelect = document.getElementById('mapsOwnerSelect');
    if (ownerSelect && !ownerSelect.dataset.bound) {
      ownerSelect.addEventListener('change', () => {
        mapsState.territory.owner = ownerSelect.value;
        applyMapsFilters();
      });
      ownerSelect.dataset.bound = '1';
    }
    const minAssets = document.getElementById('mapsMinAssets');
    if (minAssets && !minAssets.dataset.bound) {
      minAssets.addEventListener('input', () => {
        mapsState.territory.minAssets = minAssets.value;
        applyMapsFilters();
      });
      minAssets.dataset.bound = '1';
    }
    const maxAssets = document.getElementById('mapsMaxAssets');
    if (maxAssets && !maxAssets.dataset.bound) {
      maxAssets.addEventListener('input', () => {
        mapsState.territory.maxAssets = maxAssets.value;
        applyMapsFilters();
      });
      maxAssets.dataset.bound = '1';
    }
    const sortSelect = document.getElementById('mapsSortSelect');
    if (sortSelect && !sortSelect.dataset.bound) {
      sortSelect.addEventListener('change', () => {
        mapsState.territory.sort = sortSelect.value || 'opportunity';
        applyMapsFilters();
      });
      sortSelect.dataset.bound = '1';
    }
    const clearTerritory = document.getElementById('mapsClearTerritory');
    if (clearTerritory && !clearTerritory.dataset.bound) {
      clearTerritory.addEventListener('click', () => {
        mapsState.territory = { owner: '', minAssets: '', maxAssets: '', sort: 'opportunity' };
        if (ownerSelect) ownerSelect.value = '';
        if (minAssets) minAssets.value = '';
        if (maxAssets) maxAssets.value = '';
        if (sortSelect) sortSelect.value = 'opportunity';
        applyMapsFilters();
      });
      clearTerritory.dataset.bound = '1';
    }
    const advBtn = document.getElementById('mapsAdvancedBtn');
    if (advBtn && !advBtn.dataset.bound) {
      advBtn.addEventListener('click', openMapsConditionsModal);
      advBtn.dataset.bound = '1';
    }
    const fullBtn = document.getElementById('mapsFullViewBtn');
    if (fullBtn && !fullBtn.dataset.bound) {
      fullBtn.addEventListener('click', openMapsFullView);
      fullBtn.dataset.bound = '1';
    }
    const fullClose = document.getElementById('mapsFullClose');
    if (fullClose && !fullClose.dataset.bound) {
      fullClose.addEventListener('click', closeMapsFullView);
      fullClose.dataset.bound = '1';
    }
    const fullFitBtn = document.getElementById('mapsFullFitResultsBtn');
    if (fullFitBtn && !fullFitBtn.dataset.bound) {
      fullFitBtn.addEventListener('click', mapsFitResults);
      fullFitBtn.dataset.bound = '1';
    }
    const fullResetViewBtn = document.getElementById('mapsFullResetViewBtn');
    if (fullResetViewBtn && !fullResetViewBtn.dataset.bound) {
      fullResetViewBtn.addEventListener('click', mapsResetUsView);
      fullResetViewBtn.dataset.bound = '1';
    }
    const fullBackdrop = document.getElementById('mapsFullBackdrop');
    if (fullBackdrop && !fullBackdrop.dataset.bound) {
      fullBackdrop.addEventListener('click', e => {
        if (e.target === fullBackdrop) closeMapsFullView();
      });
      fullBackdrop.dataset.bound = '1';
    }
    const closeBtn = document.getElementById('mapsModalClose');
    if (closeBtn && !closeBtn.dataset.bound) {
      closeBtn.addEventListener('click', closeMapsConditionsModal);
      closeBtn.dataset.bound = '1';
    }
    const addCond = document.getElementById('mapsAddCondition');
    if (addCond && !addCond.dataset.bound) {
      addCond.addEventListener('click', () => {
        const defKey = (mapsState.fields.find(f => f.key === 'totalAssets') || mapsState.fields[0] || {}).key;
        if (defKey) mapsState.advanced.push({ field: defKey, op: '>', value: '' });
        renderMapsConditionRows();
      });
      addCond.dataset.bound = '1';
    }
    const resetCond = document.getElementById('mapsResetConditions');
    if (resetCond && !resetCond.dataset.bound) {
      resetCond.addEventListener('click', () => {
        mapsState.advanced = [];
        renderMapsConditionRows();
        applyMapsFilters();
      });
      resetCond.dataset.bound = '1';
    }
    const applyCond = document.getElementById('mapsApplyConditions');
    if (applyCond && !applyCond.dataset.bound) {
      applyCond.addEventListener('click', () => {
        const rows = document.querySelectorAll('#mapsConditionsBody .maps-cond');
        const next = [];
        rows.forEach(row => {
          const field = row.querySelector('[data-maps-cond-field]').value;
          const op = row.querySelector('[data-maps-cond-op]').value;
          const value = row.querySelector('[data-maps-cond-value]').value;
          if (value !== '') next.push({ field, op, value });
        });
        mapsState.advanced = next;
        closeMapsConditionsModal();
        applyMapsFilters();
      });
      applyCond.dataset.bound = '1';
    }
    const condBody = document.getElementById('mapsConditionsBody');
    if (condBody && !condBody.dataset.bound) {
      condBody.addEventListener('click', e => {
        const remove = e.target.closest('[data-maps-cond-remove]');
        if (remove) {
          const idx = Number(remove.closest('[data-maps-cond-idx]').dataset.mapsCondIdx);
          mapsState.advanced.splice(idx, 1);
          renderMapsConditionRows();
        }
      });
      condBody.addEventListener('change', e => {
        const row = e.target.closest('[data-maps-cond-idx]');
        if (!row) return;
        const idx = Number(row.dataset.mapsCondIdx);
        const cond = mapsState.advanced[idx];
        if (!cond) return;
        if (e.target.matches('[data-maps-cond-field]')) {
          cond.field = e.target.value;
          const def = mapsState.fieldByKey[cond.field];
          cond.op = mapsFieldFilterType(def) === 'number' ? '>' : 'contains';
          renderMapsConditionRows();
        } else if (e.target.matches('[data-maps-cond-op]')) {
          cond.op = e.target.value;
        } else if (e.target.matches('[data-maps-cond-value]')) {
          cond.value = e.target.value;
        }
      });
      condBody.dataset.bound = '1';
    }
    const tableBody = document.getElementById('mapsBankBody');
    if (tableBody && !tableBody.dataset.bound) {
      tableBody.addEventListener('click', e => {
        const btn = e.target.closest('[data-maps-bank-preview]');
        const tr = e.target.closest('tr[data-maps-bankid]');
        const id = btn ? btn.dataset.mapsBankPreview : tr && tr.dataset.mapsBankid;
        if (!id) return;
        const bank = mapsFindBank(id);
        mapsSelectBank(bank, mapsLocationGroups(mapsState.visibleBanks).find(group => group.key === mapsLocationKey(bank)));
        applyMapsFilters();
      });
      tableBody.dataset.bound = '1';
    }
    const chipsEl = document.getElementById('mapsStateChips');
    if (chipsEl && !chipsEl.dataset.bound) {
      chipsEl.addEventListener('click', e => {
        const x = e.target.closest('[data-maps-remove-state]');
        if (!x) return;
        mapsState.selectedStates.delete(x.dataset.mapsRemoveState);
        mapsSetViewport(null);
        mapsState.mapRevision += 1;
        renderMapsStateChips();
        applyMapsFilters();
      });
      chipsEl.dataset.bound = '1';
    }
    const drilldown = document.getElementById('mapsStateDrilldown');
    if (drilldown && !drilldown.dataset.bound) {
      drilldown.addEventListener('click', e => {
        const btn = e.target.closest('[data-maps-drill-type]');
        if (!btn) return;
        mapsApplyLocationDrilldown(btn);
      });
      drilldown.dataset.bound = '1';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
