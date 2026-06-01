(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FbbsMuniTax = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function parseIsoDate(dateStr) {
    if (!dateStr) return null;
    const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
    return isNaN(d) ? null : d;
  }

  function monthsBetween(start, end) {
    return (end.getFullYear() - start.getFullYear()) * 12
      + (end.getMonth() - start.getMonth())
      + ((end.getDate() - start.getDate()) / 30.4375);
  }

  function clampPercent(value, fallback, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(max == null ? 100 : max, n));
  }

  function isTaxable(row) {
    return row && row.section === 'Taxable';
  }

  function taxSettleDate(row, options) {
    return parseIsoDate(row && row.settle)
      || parseIsoDate(options && options.asOfDate)
      || new Date();
  }

  function yearsToMaturity(row, options) {
    if (!row || !row.maturity) return null;
    const settle = taxSettleDate(row, options);
    const maturity = parseIsoDate(row.maturity);
    if (!maturity || maturity <= settle) return null;
    return (maturity - settle) / (365.25 * 24 * 60 * 60 * 1000);
  }

  function fullYearsToMaturity(row, options) {
    if (!row || !row.maturity) return null;
    const settle = taxSettleDate(row, options);
    const maturity = parseIsoDate(row.maturity);
    if (!maturity || maturity <= settle) return null;
    let years = maturity.getFullYear() - settle.getFullYear();
    const maturityMonthDay = (maturity.getMonth() * 100) + maturity.getDate();
    const settleMonthDay = (settle.getMonth() * 100) + settle.getDate();
    if (maturityMonthDay < settleMonthDay) years -= 1;
    return Math.max(0, years);
  }

  function disallowancePct(row, settings) {
    if (!row || isTaxable(row) || !settings || !settings.applyTefra) return 0;
    return row.section === 'BQ'
      ? clampPercent(settings.bqDisallowance, 0)
      : clampPercent(settings.generalDisallowance, 0);
  }

  function tefraHaircutBps(row, settings) {
    const cof = clampPercent(settings && settings.costOfFunds, 0, 20);
    const taxRate = clampPercent(settings && settings.rate, 0, 99.9);
    const disallowance = disallowancePct(row, settings);
    if (!cof || !taxRate || !disallowance) return 0;
    return cof * (disallowance / 100) * taxRate;
  }

  function tey(rowOrYield, settings, rateOverride) {
    const row = typeof rowOrYield === 'object' ? rowOrYield : null;
    const y = Number(row ? row.ytw : rowOrYield);
    const r = Number(rateOverride == null ? settings && settings.rate : rateOverride);
    if (!Number.isFinite(y) || !Number.isFinite(r) || r >= 100) return null;
    const adjustedYield = y - (row ? tefraHaircutBps(row, settings) / 100 : 0);
    return adjustedYield / (1 - (r / 100));
  }

  function deMinimis(row, options) {
    if (!row || row.price == null || isTaxable(row)) return null;
    const exactYears = yearsToMaturity(row, options);
    if (!Number.isFinite(exactYears) || exactYears <= 0) return null;
    const fullYears = fullYearsToMaturity(row, options);
    if (!Number.isFinite(fullYears) || fullYears < 0) return null;
    const threshold = 100 - (0.25 * fullYears);
    const price = Number(row.price);
    const cushion = price - threshold;
    return {
      years: exactYears,
      fullYears,
      threshold,
      cushion,
      isDiscount: price < 100,
      isDeMinimis: price < threshold
    };
  }

  function solveYieldWithRedemption(couponPct, price, endDateStr, settleDateStr, redemptionValue, options) {
    const priceNum = Number(price);
    const coupon = Number(couponPct);
    const redemption = Number(redemptionValue);
    if (!Number.isFinite(priceNum) || priceNum <= 0 || !Number.isFinite(coupon) || !Number.isFinite(redemption)) return null;

    const settle = parseIsoDate(settleDateStr) || parseIsoDate(options && options.asOfDate) || new Date();
    const endDate = parseIsoDate(endDateStr);
    if (!endDate || endDate <= settle) return null;

    const periods = Math.max(1, Math.ceil(monthsBetween(settle, endDate) / 6));
    const couponPerPeriod = coupon / 2;

    let low = -0.95;
    let high = 1.5;
    for (let i = 0; i < 80; i++) {
      const mid = (low + high) / 2;
      const rate = mid / 2;
      let pv = 0;
      for (let period = 1; period <= periods; period++) {
        pv += couponPerPeriod / Math.pow(1 + rate, period);
      }
      pv += redemption / Math.pow(1 + rate, periods);
      if (pv > priceNum) low = mid;
      else high = mid;
    }
    return ((low + high) / 2) * 100;
  }

  function afterTaxYield(row, settings, options) {
    const deMin = deMinimis(row, options);
    if (!row || row.price == null || row.coupon == null || !deMin || !deMin.isDiscount) return null;
    const discount = Math.max(0, 100 - Number(row.price));
    const taxRate = (deMin.isDeMinimis ? settings.rate : settings.capitalGainsRate) / 100;
    const afterTaxRedemption = 100 - (discount * clampPercent(taxRate * 100, 0, 99.9) / 100);
    const aty = solveYieldWithRedemption(row.coupon, row.price, row.maturity, row.settle, afterTaxRedemption, options);
    return aty == null ? null : aty;
  }

  function taxAdjustedYield(row, settings, options) {
    if (!row || isTaxable(row)) return null;
    const taxRate = clampPercent(settings && settings.rate, 0, 99.9);
    const haircutYield = tefraHaircutBps(row, settings) / 100;
    const deMin = deMinimis(row, options);
    if (deMin && deMin.isDiscount) {
      const aty = afterTaxYield(row, settings, options);
      if (aty != null) {
        return {
          label: 'TEY',
          value: (aty - haircutYield) / (1 - (taxRate / 100)),
          secondaryLabel: 'ATY',
          secondaryValue: aty
        };
      }
    }
    const adjusted = tey(row, settings);
    return adjusted == null ? null : { label: 'TEY', value: adjusted };
  }

  return {
    parseIsoDate,
    monthsBetween,
    clampPercent,
    yearsToMaturity,
    fullYearsToMaturity,
    disallowancePct,
    tefraHaircutBps,
    tey,
    deMinimis,
    solveYieldWithRedemption,
    afterTaxYield,
    taxAdjustedYield
  };
});
