const statusEl = document.getElementById('status');
const gamesEl = document.getElementById('games');
const analysisEl = document.getElementById('analysis');

const ODDS_API_KEY = '8a61d585e42c3c2ae6cd592a78c41019';
const ODDS_API_SPORT = 'basketball_nba';
const ODDS_API_REGIONS = 'eu,uk,us';
const ODDS_API_MARKETS = 'h2h,spreads,totals';
const BOOKMAKER_PRIORITY = ['betano', 'novibet', 'bet365', 'bet365_uk'];

let scoreboardCache = [];
let oddsCache = [];

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeString(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
  const cleaned = String(value).replace(/[^\d.-]/g, '');
  const num = Number(cleaned);
  return Number.isNaN(num) ? null : num;
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatOneDecimal(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'Pendiente';
  return Number(value).toFixed(1);
}

function formatOddsDecimal(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'Pendiente';
  return Number(value).toFixed(2);
}

function formatDateTime(dateString) {
  if (!dateString) return 'Sin hora';
  return new Date(dateString).toLocaleString('es-CL', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getTeamIdFromCompetitor(competitor) {
  return competitor?.team?.id || competitor?.id || null;
}

function normalizeGamesFromSchedule(data) {
  return Array.isArray(data?.events) ? data.events : [];
}

function getTeamGameInfo(event, teamId) {
  const comp = event?.competitions?.[0];
  if (!comp) return null;

  const competitors = comp?.competitors || [];
  const team = competitors.find(c => String(c?.team?.id || c?.id || '') === String(teamId));
  const opponent = competitors.find(c => String(c?.team?.id || c?.id || '') !== String(teamId));
  if (!team || !opponent) return null;

  const rawTeamScore = team?.score;
  const rawOpponentScore = opponent?.score;
  const teamScore = typeof rawTeamScore === 'object' ? toNumber(rawTeamScore?.value ?? rawTeamScore?.displayValue) : toNumber(rawTeamScore);
  const opponentScore = typeof rawOpponentScore === 'object' ? toNumber(rawOpponentScore?.value ?? rawOpponentScore?.displayValue) : toNumber(rawOpponentScore);
  const date = event?.date || comp?.date || null;
  const statusType = comp?.status?.type || event?.status?.type || {};
  const completed = Boolean(statusType?.completed || statusType?.state === 'post');

  return {
    date,
    completed,
    homeAway: team?.homeAway || 'unknown',
    teamScore,
    opponentScore,
    won: teamScore !== null && opponentScore !== null ? teamScore > opponentScore : null
  };
}

function getRecentFormFromSchedule(data, teamId, gameDate, sampleSize = 5) {
  const events = normalizeGamesFromSchedule(data);
  const targetTime = gameDate ? new Date(gameDate).getTime() : Date.now();

  const recentGames = events
    .map(event => getTeamGameInfo(event, teamId))
    .filter(Boolean)
    .filter(game => game.completed)
    .filter(game => game.date && new Date(game.date).getTime() < targetTime)
    .filter(game => game.teamScore !== null && game.opponentScore !== null)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, sampleSize);

  return {
    wins: recentGames.filter(game => game.won === true).length,
    losses: recentGames.filter(game => game.won === false).length,
    scoredAvg: average(recentGames.map(game => game.teamScore)),
    allowedAvg: average(recentGames.map(game => game.opponentScore)),
    diffAvg: average(recentGames.map(game => game.teamScore - game.opponentScore))
  };
}

function getVenueSplitForm(scheduleData, teamId, gameDate, venueType, sampleSize = 5) {
  const events = normalizeGamesFromSchedule(scheduleData);
  const targetTime = gameDate ? new Date(gameDate).getTime() : Date.now();
  const filtered = events
    .map(event => getTeamGameInfo(event, teamId))
    .filter(Boolean)
    .filter(game => game.completed)
    .filter(game => game.date && new Date(game.date).getTime() < targetTime)
    .filter(game => game.teamScore !== null && game.opponentScore !== null)
    .filter(game => game.homeAway === venueType)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, sampleSize);

  return {
    wins: filtered.filter(game => game.won === true).length,
    losses: filtered.filter(game => game.won === false).length,
    diffAvg: average(filtered.map(game => game.teamScore - game.opponentScore))
  };
}

function getB2BStatus(data, teamId, gameDate) {
  const events = normalizeGamesFromSchedule(data);
  const targetTime = gameDate ? new Date(gameDate).getTime() : null;
  if (!targetTime) return { isB2B: false, detail: 'Sin dato' };

  const previousGames = events
    .map(event => getTeamGameInfo(event, teamId))
    .filter(Boolean)
    .filter(game => game.completed)
    .filter(game => game.date)
    .filter(game => new Date(game.date).getTime() < targetTime)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const previousGame = previousGames[0];
  if (!previousGame) return { isB2B: false, detail: 'Descanso normal' };
  const diffHours = (targetTime - new Date(previousGame.date).getTime()) / (1000 * 60 * 60);
  if (diffHours <= 30) return { isB2B: true, detail: previousGame.homeAway === 'away' ? 'B2B con viaje' : 'B2B' };
  return { isB2B: false, detail: 'Descanso normal' };
}

async function fetchTeamSchedule(teamId) {
  if (!teamId) return null;
  const urls = [
    `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/schedule`,
    `https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/schedule`
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const data = await response.json();
      if (Array.isArray(data?.events)) return data;
    } catch (error) {
      console.warn('Schedule fetch failed:', url, error);
    }
  }
  return null;
}

function impliedProbabilityFromDecimal(decimalOdds) {
  const odds = Number(decimalOdds);
  if (!odds || Number.isNaN(odds) || odds <= 1) return null;
  return 1 / odds;
}

function decimalFromImpliedProbability(probability) {
  const p = Number(probability);
  if (!p || Number.isNaN(p) || p <= 0 || p >= 1) return null;
  return 1 / p;
}

function getBookmakerPriorityIndex(key) {
  const idx = BOOKMAKER_PRIORITY.indexOf(String(key || '').toLowerCase());
  return idx === -1 ? 999 : idx;
}

function normalizeBookmakers(bookmakers) {
  return (bookmakers || []).map(bookmaker => ({
    ...bookmaker,
    key: String(bookmaker?.key || '').toLowerCase(),
    title: bookmaker?.title || bookmaker?.key || 'Casa'
  }));
}

function sortBookmakersByPriority(bookmakers) {
  return [...normalizeBookmakers(bookmakers)].sort((a, b) => {
    const priorityDiff = getBookmakerPriorityIndex(a.key) - getBookmakerPriorityIndex(b.key);
    if (priorityDiff !== 0) return priorityDiff;
    return String(a.title).localeCompare(String(b.title));
  });
}

function findOutcomeByTeamName(outcomes, teamName) {
  const target = normalizeString(teamName);
  return (outcomes || []).find(outcome => normalizeString(outcome?.name) === target) || null;
}

function buildOddsApiEventMatchScore(oddsEvent, homeName, awayName, commenceTime = null) {
  const oddsHome = normalizeString(oddsEvent?.home_team);
  const oddsAway = normalizeString(oddsEvent?.away_team);
  const targetHome = normalizeString(homeName);
  const targetAway = normalizeString(awayName);
  let score = 0;
  if (oddsHome === targetHome) score += 6;
  else if (oddsHome.includes(targetHome) || targetHome.includes(oddsHome)) score += 3;
  if (oddsAway === targetAway) score += 6;
  else if (oddsAway.includes(targetAway) || targetAway.includes(oddsAway)) score += 3;
  if (commenceTime && oddsEvent?.commence_time) {
    const diff = Math.abs(new Date(oddsEvent.commence_time).getTime() - new Date(commenceTime).getTime());
    if (diff <= 1000 * 60 * 180) score += 2;
    else if (diff <= 1000 * 60 * 360) score += 1;
  }
  return score;
}

function findMatchingOddsEvent(oddsEvents, homeName, awayName, commenceTime = null) {
  if (!Array.isArray(oddsEvents) || !oddsEvents.length) return null;
  const scored = oddsEvents
    .map(event => ({ event, score: buildOddsApiEventMatchScore(event, homeName, awayName, commenceTime) }))
    .filter(item => item.score >= 7)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.event || null;
}

async function fetchOddsApiEvents() {
  const url = `https://api.the-odds-api.com/v4/sports/${ODDS_API_SPORT}/odds?apiKey=${encodeURIComponent(ODDS_API_KEY)}&regions=${encodeURIComponent(ODDS_API_REGIONS)}&markets=${encodeURIComponent(ODDS_API_MARKETS)}&oddsFormat=decimal&dateFormat=iso`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Odds API HTTP ${res.status}`);
  return res.json();
}

function classifyBetStrength(edgeGap, odds, contextPenalty = 0) {
  const adjustedGap = Math.max(0, edgeGap - contextPenalty);
  const safeOdds = Number(odds);
  if (Number.isNaN(safeOdds) || safeOdds < 1.5) return { level: 'No bet', stake: '0u' };
  if (adjustedGap >= 3.2 && safeOdds >= 1.62) return { level: 'Fuerte', stake: '1.0u' };
  if (adjustedGap >= 2.0 && safeOdds >= 1.55) return { level: 'Media', stake: '0.75u' };
  if (adjustedGap >= 1.1 && safeOdds >= 1.5) return { level: 'Leve', stake: '0.5u' };
  return { level: 'No bet', stake: '0u' };
}

function makeNoBet(reason) {
  return { selection: null, strength: { level: 'No bet', stake: '0u' }, reason };
}

function estimateAdjustedOdds(basePoint, baseOdds, targetPoint, factorPerPoint = 0.022) {
  const baseProb = impliedProbabilityFromDecimal(baseOdds);
  if (baseProb === null) return null;
  const moveTowardBettor = Math.abs(basePoint) - Math.abs(targetPoint);
  if (moveTowardBettor <= 0) return null;
  const addedProb = moveTowardBettor * factorPerPoint;
  const estimatedProb = Math.min(0.92, baseProb + addedProb);
  const estimatedOdds = decimalFromImpliedProbability(estimatedProb);
  if (estimatedOdds === null) return null;
  return Number(estimatedOdds.toFixed(2));
}

function getSuggestedAlternateSpread(mainSpreadPoint, modelMarginAbs) {
  const spreadAbs = Math.abs(mainSpreadPoint);
  const modelAbs = Math.abs(modelMarginAbs);
  if (Number.isNaN(spreadAbs) || Number.isNaN(modelAbs)) return null;
  const safeAbs = Math.max(1.5, Math.floor((Math.max(modelAbs - 1.5, 1.5)) * 2) / 2);
  if (safeAbs >= spreadAbs) return null;
  return mainSpreadPoint < 0 ? -safeAbs : safeAbs;
}

function getSuggestedAlternateTotal(mainTotalPoint, projectedTotal, side = 'over') {
  if (mainTotalPoint === null || projectedTotal === null) return null;
  const gap = Math.abs(projectedTotal - mainTotalPoint);
  if (gap < 3.5) return null;
  if (side === 'over') {
    const target = Math.floor((mainTotalPoint - 4.5) * 2) / 2;
    return target < mainTotalPoint ? target : null;
  }
  const target = Math.ceil((mainTotalPoint + 4.5) * 2) / 2;
  return target > mainTotalPoint ? target : null;
}

function isMinimumPlayableOdds(odds) {
  const n = Number(odds);
  return !Number.isNaN(n) && n >= 1.5;
}

function selectSideRecommendation(bookmakers, preferredSideName, modelMarginAbs = null) {
  const ordered = sortBookmakersByPriority(bookmakers);
  for (const bookmaker of ordered) {
    const h2h = bookmaker?.markets?.find(m => m?.key === 'h2h');
    const spreads = bookmaker?.markets?.find(m => m?.key === 'spreads');
    const spreadOutcome = findOutcomeByTeamName(spreads?.outcomes || [], preferredSideName);
    const spreadPrice = Number(spreadOutcome?.price);
    const spreadPoint = Number(spreadOutcome?.point);
    const hasSpread = spreadOutcome && !Number.isNaN(spreadPrice) && !Number.isNaN(spreadPoint);
    const modelAbs = Number(modelMarginAbs);

    if (hasSpread && modelAbs !== null && !Number.isNaN(modelAbs)) {
      const lineTooHigh = spreadPoint < 0 && Math.abs(spreadPoint) > Math.max(4.5, modelAbs - 0.5);
      const spreadHasValue = modelAbs >= 2.5 && isMinimumPlayableOdds(spreadPrice) && !lineTooHigh;
      if (spreadHasValue) {
        return {
          type: 'spread',
          marketLabel: 'SPREAD',
          bookmakerTitle: bookmaker.title,
          label: `${preferredSideName} ${spreadPoint > 0 ? `+${spreadPoint}` : spreadPoint}`,
          odds: spreadPrice,
          isEstimated: false
        };
      }
      const altPoint = getSuggestedAlternateSpread(spreadPoint, modelAbs);
      const altOdds = altPoint !== null ? estimateAdjustedOdds(spreadPoint, spreadPrice, altPoint, 0.022) : null;
      if (altPoint !== null && altOdds !== null && isMinimumPlayableOdds(altOdds) && modelAbs >= 2.5) {
        return {
          type: 'alternate-spread-estimated',
          marketLabel: 'SPREAD ALTERNATIVO',
          bookmakerTitle: bookmaker.title,
          label: `${preferredSideName} ${altPoint > 0 ? `+${altPoint}` : altPoint}`,
          odds: altOdds,
          isEstimated: true,
          derivedFromLabel: `${preferredSideName} ${spreadPoint > 0 ? `+${spreadPoint}` : spreadPoint} @ ${formatOddsDecimal(spreadPrice)}`
        };
      }
    }

    const mlOutcome = findOutcomeByTeamName(h2h?.outcomes || [], preferredSideName);
    const mlPrice = Number(mlOutcome?.price);
    if (mlOutcome && isMinimumPlayableOdds(mlPrice)) {
      return {
        type: 'moneyline',
        marketLabel: 'MONEYLINE',
        bookmakerTitle: bookmaker.title,
        label: `${preferredSideName} gana`,
        odds: mlPrice,
        isEstimated: false
      };
    }
  }
  return null;
}

function selectTotalRecommendation(bookmakers, projectedTotal) {
  if (projectedTotal === null) return null;
  const ordered = sortBookmakersByPriority(bookmakers);
  for (const bookmaker of ordered) {
    const totals = bookmaker?.markets?.find(m => m?.key === 'totals');
    const over = (totals?.outcomes || []).find(o => normalizeString(o?.name) === 'over');
    const under = (totals?.outcomes || []).find(o => normalizeString(o?.name) === 'under');
    const overPoint = Number(over?.point);
    const underPoint = Number(under?.point);
    const overPrice = Number(over?.price);
    const underPrice = Number(under?.price);

    if (!Number.isNaN(overPoint) && !Number.isNaN(overPrice) && projectedTotal >= overPoint + 4.0) {
      if (isMinimumPlayableOdds(overPrice)) {
        return {
          type: 'total',
          marketLabel: 'TOTAL',
          bookmakerTitle: bookmaker.title,
          label: `Más de ${overPoint}`,
          odds: overPrice,
          isEstimated: false
        };
      }
      const altPoint = getSuggestedAlternateTotal(overPoint, projectedTotal, 'over');
      const altOdds = altPoint !== null ? estimateAdjustedOdds(overPoint, overPrice, altPoint, 0.018) : null;
      if (altPoint !== null && altOdds !== null && isMinimumPlayableOdds(altOdds)) {
        return {
          type: 'alternate-total-estimated',
          marketLabel: 'TOTAL ALTERNATIVO',
          bookmakerTitle: bookmaker.title,
          label: `Más de ${altPoint}`,
          odds: altOdds,
          isEstimated: true,
          derivedFromLabel: `Más de ${overPoint} @ ${formatOddsDecimal(overPrice)}`
        };
      }
    }

    if (!Number.isNaN(underPoint) && !Number.isNaN(underPrice) && projectedTotal <= underPoint - 4.0) {
      if (isMinimumPlayableOdds(underPrice)) {
        return {
          type: 'total',
          marketLabel: 'TOTAL',
          bookmakerTitle: bookmaker.title,
          label: `Menos de ${underPoint}`,
          odds: underPrice,
          isEstimated: false
        };
      }
      const altPoint = getSuggestedAlternateTotal(underPoint, projectedTotal, 'under');
      const altOdds = altPoint !== null ? estimateAdjustedOdds(underPoint, underPrice, altPoint, 0.018) : null;
      if (altPoint !== null && altOdds !== null && isMinimumPlayableOdds(altOdds)) {
        return {
          type: 'alternate-total-estimated',
          marketLabel: 'TOTAL ALTERNATIVO',
          bookmakerTitle: bookmaker.title,
          label: `Menos de ${altPoint}`,
          odds: altOdds,
          isEstimated: true,
          derivedFromLabel: `Menos de ${underPoint} @ ${formatOddsDecimal(underPrice)}`
        };
      }
    }
  }
  return null;
}

function buildOddsRecommendation({ oddsEvent, awayName, homeName, awayEdge, homeEdge, projectedTotal, projectedSpread, awayAvailabilityPenalty = 0, homeAvailabilityPenalty = 0 }) {
  if (!oddsEvent?.bookmakers?.length) return makeNoBet('No se encontraron cuotas disponibles para este partido.');
  const adjustedAwayEdge = awayEdge - awayAvailabilityPenalty;
  const adjustedHomeEdge = homeEdge - homeAvailabilityPenalty;
  const edgeGap = Math.abs(adjustedAwayEdge - adjustedHomeEdge);
  const contextPenalty = Math.max(awayAvailabilityPenalty, homeAvailabilityPenalty) >= 1.5 ? 1 : 0;

  if (adjustedAwayEdge >= adjustedHomeEdge + 0.75) {
    const selection = selectSideRecommendation(oddsEvent.bookmakers, awayName, Math.abs(projectedSpread));
    if (selection && isMinimumPlayableOdds(selection.odds)) {
      const strength = classifyBetStrength(edgeGap, selection.odds, contextPenalty);
      if (strength.level !== 'No bet') {
        return { selection, strength, reason: `${awayName} respalda mejor la lectura estadística global.` };
      }
    }
  }

  if (adjustedHomeEdge >= adjustedAwayEdge + 0.75) {
    const selection = selectSideRecommendation(oddsEvent.bookmakers, homeName, Math.abs(projectedSpread));
    if (selection && isMinimumPlayableOdds(selection.odds)) {
      const strength = classifyBetStrength(edgeGap, selection.odds, contextPenalty);
      if (strength.level !== 'No bet') {
        return { selection, strength, reason: `${homeName} respalda mejor la lectura estadística global.` };
      }
    }
  }

  const totalSelection = selectTotalRecommendation(oddsEvent.bookmakers, projectedTotal);
  if (totalSelection && isMinimumPlayableOdds(totalSelection.odds)) {
    const strength = classifyBetStrength(Math.max(1.35, edgeGap), totalSelection.odds, contextPenalty);
    if (strength.level !== 'No bet') {
      return { selection: totalSelection, strength, reason: 'El mejor ángulo del matchup aparece en el total.' };
    }
  }

  return makeNoBet('No hay una opción que combine respaldo estadístico suficiente con cuota mínima 1.50.');
}

async function fetchEspnInjuriesPage(teamAbbr = '') {
  if (!teamAbbr) return '';
  const urls = [
    `https://www.espn.com/nba/injuries/_/team/${teamAbbr.toLowerCase()}`,
    'https://www.espn.com/nba/injuries'
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const text = await res.text();
      if (text) return text;
    } catch (error) {
      console.warn('Injuries fetch failed:', url, error);
    }
  }
  return '';
}

function extractEspnTeamInjuries(html) {
  const text = String(html || '');
  if (!text) return [];
  const rows = [];
  const nameRegex = /"fullName":"([^"]+)"/g;
  let match;
  while ((match = nameRegex.exec(text)) !== null) {
    const start = match.index;
    const chunk = text.slice(start, start + 500);
    const player = match[1];
    const statusMatch = chunk.match(/"status":"([^"]+)"/i) || chunk.match(/"comment":"([^"]+)"/i);
    rows.push({ player, status: statusMatch?.[1] || 'Pendiente' });
  }
  return rows
    .filter(item => item.player && item.status)
    .filter((item, index, arr) => arr.findIndex(x => normalizeString(x.player) === normalizeString(item.player)) === index)
    .slice(0, 8);
}

async function fetchRotowireLineupsHtml(dateMode = 'today') {
  const url = dateMode === 'tomorrow'
    ? 'https://www.rotowire.com/basketball/nba-lineups.php?date=tomorrow'
    : 'https://www.rotowire.com/basketball/nba-lineups.php';
  try {
    const res = await fetch(url);
    if (!res.ok) return '';
    return await res.text();
  } catch (error) {
    console.warn('RotoWire fetch failed:', url, error);
    return '';
  }
}

function extractTeamLineupInfoFromHtml(html, teamName, teamAbbr) {
  const safeHtml = String(html || '');
  const normalizedTeamName = normalizeString(teamName);
  const normalizedTeamAbbr = normalizeString(teamAbbr);
  const emptyResult = { lineupConfirmed: false, lineupExpected: false, starters: [], injuries: [] };
  if (!safeHtml || (!normalizedTeamName && !normalizedTeamAbbr)) return emptyResult;

  const cleanText = safeHtml
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(div|section|article|li|p|tr|td|h1|h2|h3|h4|h5|h6|span)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n');

  const lines = cleanText.split('\n').map(line => line.trim()).filter(Boolean);
  const teamIndexes = lines
    .map((line, idx) => ({ idx, normalized: normalizeString(line) }))
    .filter(item => (normalizedTeamName && item.normalized.includes(normalizedTeamName)) || (normalizedTeamAbbr && item.normalized.includes(normalizedTeamAbbr)))
    .map(item => item.idx);

  if (!teamIndexes.length) return emptyResult;

  const starters = [];
  const injuries = [];
  let lineupConfirmed = false;
  let lineupExpected = false;

  for (const idx of teamIndexes.slice(0, 4)) {
    const block = lines.slice(Math.max(0, idx - 10), Math.min(lines.length, idx + 55));
    const blockText = normalizeString(block.join(' '));
    if (blockText.includes('confirmed lineup')) lineupConfirmed = true;
    if (blockText.includes('expected lineup') || blockText.includes('projected lineup')) lineupExpected = true;

    for (let i = 0; i < block.length - 1; i++) {
      const pos = normalizeString(block[i]);
      const next = String(block[i + 1] || '').trim();
      if (['pg', 'sg', 'sf', 'pf', 'c'].includes(pos)) {
        if (/^[A-Z][A-Za-z'.\-]+(?:\s+[A-Z][A-Za-z'.\-]+)+$/.test(next)) {
          const dedupeKey = `${pos}-${normalizeString(next)}`;
          const exists = starters.some(item => `${normalizeString(item.position)}-${normalizeString(item.player)}` === dedupeKey);
          if (!exists) starters.push({ position: block[i].toUpperCase(), player: next });
        }
      }
    }

    const injuryRegex = /([A-Z][A-Za-z'.\-]+(?:\s+[A-Z][A-Za-z'.\-]+)+)\s+(Out|Questionable|Doubtful|Probable|Game Time Decision|Day-To-Day|GTD)/g;
    const joinedBlock = block.join(' ');
    let injuryMatch;
    while ((injuryMatch = injuryRegex.exec(joinedBlock)) !== null) {
      const exists = injuries.some(item => normalizeString(item.player) === normalizeString(injuryMatch[1]));
      if (!exists) injuries.push({ player: injuryMatch[1], status: injuryMatch[2] });
    }
    if (starters.length >= 5) break;
  }

  return {
    lineupConfirmed,
    lineupExpected: lineupExpected || lineupConfirmed,
    starters: starters.slice(0, 5),
    injuries: injuries.slice(0, 8)
  };
}

async function getTeamAvailability(teamName, teamAbbr) {
  const [espnHtml, rwTodayHtml, rwTomorrowHtml] = await Promise.all([
    fetchEspnInjuriesPage(teamAbbr),
    fetchRotowireLineupsHtml('today'),
    fetchRotowireLineupsHtml('tomorrow')
  ]);

  const espnInjuries = extractEspnTeamInjuries(espnHtml);
  const rwToday = extractTeamLineupInfoFromHtml(rwTodayHtml, teamName, teamAbbr);
  const rwTomorrow = extractTeamLineupInfoFromHtml(rwTomorrowHtml, teamName, teamAbbr);
  const lineupSource = rwToday.lineupExpected || rwToday.lineupConfirmed || rwToday.starters.length ? rwToday : rwTomorrow;
  const mergedInjuries = [...(lineupSource.injuries || [])];

  for (const item of espnInjuries) {
    const exists = mergedInjuries.some(existing => normalizeString(existing.player) === normalizeString(item.player));
    if (!exists) mergedInjuries.push({ player: item.player, status: item.status });
  }

  return {
    lineupConfirmed: Boolean(lineupSource.lineupConfirmed),
    lineupExpected: Boolean(lineupSource.lineupExpected),
    starters: lineupSource.starters || [],
    injuries: mergedInjuries.slice(0, 8)
  };
}

function summarizeAvailability(availability) {
  if (!availability) return { display: 'Sin datos', scorePenalty: 0 };
  const injuries = availability.injuries || [];
  const scorePenalty = injuries.reduce((sum, item) => {
    const txt = normalizeString(item.status);
    if (txt.includes('out')) return sum + 1.2;
    if (txt.includes('question')) return sum + 0.5;
    if (txt.includes('doubt')) return sum + 0.8;
    if (txt.includes('probable')) return sum + 0.15;
    return sum + 0.2;
  }, 0);
  const lineupLabel = availability.lineupConfirmed ? 'Confirmado' : availability.lineupExpected ? 'Probable' : 'Sin confirmar';
  return {
    display: `Lineup ${lineupLabel}${injuries.length ? ` · ${injuries.length} bajas/dudas` : ''}`,
    scorePenalty: Number(scorePenalty.toFixed(2))
  };
}

function renderGames(events) {
  gamesEl.innerHTML = events.map(event => {
    const comp = event.competitions?.[0] || {};
    const competitors = comp.competitors || [];
    const home = competitors.find(team => team.homeAway === 'home');
    const away = competitors.find(team => team.homeAway === 'away');
    if (!home || !away) return '';
    return `
      <button class="game-btn" data-game-id="${escapeHtml(event.id)}">
        <div class="matchup">${escapeHtml(away.team.displayName)} vs ${escapeHtml(home.team.displayName)}</div>
        <div class="meta">${escapeHtml(formatDateTime(event.date))}</div>
      </button>
    `;
  }).join('');
}

function renderLineupCard(teamName, availabilitySummary, availability) {
  const starters = Array.isArray(availability?.starters) ? availability.starters : [];
  const injuries = Array.isArray(availability?.injuries) ? availability.injuries : [];
  return `
    <div class="panel-card">
      <h4>${escapeHtml(teamName)}</h4>
      <p class="muted">${escapeHtml(availabilitySummary.display)}</p>
      <div class="mini-title">Titulares</div>
      ${starters.length ? starters.map(item => `<div class="line-item">${escapeHtml(item.position)} · ${escapeHtml(item.player)}</div>`).join('') : '<div class="line-item empty">No detectado</div>'}
      <div class="mini-title">Bajas / dudas</div>
      ${injuries.length ? injuries.slice(0, 6).map(item => `<div class="line-item">${escapeHtml(item.player)}: ${escapeHtml(item.status || 'Pendiente')}</div>`).join('') : '<div class="line-item empty">Sin novedades detectadas</div>'}
    </div>
  `;
}

function renderRecommendationCard(recommendation) {
  if (!recommendation?.selection) {
    return `
      <div class="pick-card no-bet">
        <div class="eyebrow">Recomendación</div>
        <div class="pick-main">No bet</div>
        <p>${escapeHtml(recommendation?.reason || 'Sin recomendación')}</p>
      </div>
    `;
  }
  return `
    <div class="pick-card">
      <div class="eyebrow">Recomendación</div>
      <div class="pick-main">${escapeHtml(recommendation.selection.label)}</div>
      <div class="chips">
        <span>${escapeHtml(recommendation.selection.marketLabel)}</span>
        <span>Cuota ${escapeHtml(formatOddsDecimal(recommendation.selection.odds))}</span>
        <span>${escapeHtml(recommendation.strength.level)} · ${escapeHtml(recommendation.strength.stake)}</span>
        <span>${escapeHtml(recommendation.selection.bookmakerTitle || 'Casa')}</span>
      </div>
      <p>${escapeHtml(recommendation.reason || '')}</p>
      ${recommendation.selection.isEstimated && recommendation.selection.derivedFromLabel ? `<div class="derived">Alternativa basada en: ${escapeHtml(recommendation.selection.derivedFromLabel)}</div>` : ''}
    </div>
  `;
}

async function analyzeGame(gameId) {
  const event = scoreboardCache.find(item => String(item.id) === String(gameId));
  if (!event) return;

  analysisEl.innerHTML = '<div class="loading">Cargando análisis de prueba...</div>';

  const comp = event.competitions?.[0] || {};
  const competitors = comp.competitors || [];
  const home = competitors.find(team => team.homeAway === 'home');
  const away = competitors.find(team => team.homeAway === 'away');
  if (!home || !away) return;

  const homeName = home.team.displayName;
  const awayName = away.team.displayName;
  const homeAbbr = home.team.abbreviation;
  const awayAbbr = away.team.abbreviation;
  const homeTeamId = getTeamIdFromCompetitor(home);
  const awayTeamId = getTeamIdFromCompetitor(away);

  try {
    const [homeSchedule, awaySchedule, homeAvailability, awayAvailability] = await Promise.all([
      fetchTeamSchedule(homeTeamId),
      fetchTeamSchedule(awayTeamId),
      getTeamAvailability(homeName, homeAbbr),
      getTeamAvailability(awayName, awayAbbr)
    ]);

    const homeRecent = getRecentFormFromSchedule(homeSchedule, homeTeamId, comp.date, 5);
    const awayRecent = getRecentFormFromSchedule(awaySchedule, awayTeamId, comp.date, 5);
    const homeVenue = getVenueSplitForm(homeSchedule, homeTeamId, comp.date, 'home', 5);
    const awayVenue = getVenueSplitForm(awaySchedule, awayTeamId, comp.date, 'away', 5);
    const homeB2B = getB2BStatus(homeSchedule, homeTeamId, comp.date);
    const awayB2B = getB2BStatus(awaySchedule, awayTeamId, comp.date);

    const homeAvailabilitySummary = summarizeAvailability(homeAvailability);
    const awayAvailabilitySummary = summarizeAvailability(awayAvailability);

    let awayEdge = 0;
    let homeEdge = 0;

    if (awayRecent.diffAvg !== null && homeRecent.diffAvg !== null) {
      if (awayRecent.diffAvg > homeRecent.diffAvg) awayEdge += 2;
      if (homeRecent.diffAvg > awayRecent.diffAvg) homeEdge += 2;
    }
    if (awayRecent.scoredAvg !== null && homeRecent.scoredAvg !== null) {
      if (awayRecent.scoredAvg > homeRecent.scoredAvg) awayEdge += 1;
      if (homeRecent.scoredAvg > awayRecent.scoredAvg) homeEdge += 1;
    }
    if (awayRecent.allowedAvg !== null && homeRecent.allowedAvg !== null) {
      if (awayRecent.allowedAvg < homeRecent.allowedAvg) awayEdge += 1;
      if (homeRecent.allowedAvg < awayRecent.allowedAvg) homeEdge += 1;
    }
    if (awayVenue.diffAvg !== null && homeVenue.diffAvg !== null) {
      if (awayVenue.diffAvg > homeVenue.diffAvg) awayEdge += 1;
      if (homeVenue.diffAvg > awayVenue.diffAvg) homeEdge += 1;
    }
    if (awayB2B.isB2B && !homeB2B.isB2B) homeEdge += 1;
    if (homeB2B.isB2B && !awayB2B.isB2B) awayEdge += 1;

    const projectedSpread = Number(((homeRecent.diffAvg ?? 0) - (awayRecent.diffAvg ?? 0)) * -0.55).toFixed(1);
    const projectedTotal = Number(((homeRecent.scoredAvg ?? 110) + (awayRecent.scoredAvg ?? 110) + (homeRecent.allowedAvg ?? 110) + (awayRecent.allowedAvg ?? 110)) / 2).toFixed(1);

    const oddsEvent = findMatchingOddsEvent(oddsCache, homeName, awayName, comp.date);
    const recommendation = buildOddsRecommendation({
      oddsEvent,
      awayName,
      homeName,
      awayEdge,
      homeEdge,
      projectedTotal: Number(projectedTotal),
      projectedSpread: Number(projectedSpread),
      awayAvailabilityPenalty: awayAvailabilitySummary.scorePenalty,
      homeAvailabilityPenalty: homeAvailabilitySummary.scorePenalty
    });

    analysisEl.innerHTML = `
      <div class="analysis-box">
        <div class="header-row">
          <div>
            <h3>${escapeHtml(awayName)} vs ${escapeHtml(homeName)}</h3>
            <p class="muted">${escapeHtml(formatDateTime(comp.date))}</p>
          </div>
        </div>

        ${renderRecommendationCard(recommendation)}

        <div class="stats-grid">
          <div class="panel-card">
            <h4>Lectura base</h4>
            <div class="line-item">${escapeHtml(awayName)} edge: ${escapeHtml(String(awayEdge))}</div>
            <div class="line-item">${escapeHtml(homeName)} edge: ${escapeHtml(String(homeEdge))}</div>
            <div class="line-item">Spread proyectado: ${escapeHtml(String(projectedSpread))}</div>
            <div class="line-item">Total proyectado: ${escapeHtml(String(projectedTotal))}</div>
          </div>
          <div class="panel-card">
            <h4>Forma reciente</h4>
            <div class="line-item">${escapeHtml(awayName)}: ${escapeHtml(formatOneDecimal(awayRecent.scoredAvg))} anotados / ${escapeHtml(formatOneDecimal(awayRecent.allowedAvg))} recibidos</div>
            <div class="line-item">${escapeHtml(homeName)}: ${escapeHtml(formatOneDecimal(homeRecent.scoredAvg))} anotados / ${escapeHtml(formatOneDecimal(homeRecent.allowedAvg))} recibidos</div>
            <div class="line-item">${escapeHtml(awayName)} fuera: ${escapeHtml(formatOneDecimal(awayVenue.diffAvg))}</div>
            <div class="line-item">${escapeHtml(homeName)} casa: ${escapeHtml(formatOneDecimal(homeVenue.diffAvg))}</div>
            <div class="line-item">B2B: ${escapeHtml(awayName)} ${escapeHtml(awayB2B.detail)} · ${escapeHtml(homeName)} ${escapeHtml(homeB2B.detail)}</div>
          </div>
        </div>

        <div class="stats-grid lineup-grid">
          ${renderLineupCard(awayName, awayAvailabilitySummary, awayAvailability)}
          ${renderLineupCard(homeName, homeAvailabilitySummary, homeAvailability)}
        </div>
      </div>
    `;
  } catch (error) {
    console.error(error);
    analysisEl.innerHTML = `<div class="analysis-box"><div class="pick-card no-bet"><div class="pick-main">Error</div><p>No se pudo completar la prueba real de este partido.</p></div></div>`;
  }
}

async function loadGames() {
  statusEl.textContent = 'Cargando juegos reales de hoy...';
  try {
    const [scoreboardRes, oddsRes] = await Promise.all([
      fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard'),
      fetchOddsApiEvents()
    ]);

    if (!scoreboardRes.ok) throw new Error(`Scoreboard HTTP ${scoreboardRes.status}`);
    const scoreboardData = await scoreboardRes.json();
    scoreboardCache = scoreboardData.events || [];
    oddsCache = Array.isArray(oddsRes) ? oddsRes : [];

    statusEl.textContent = `Juegos cargados: ${scoreboardCache.length}`;
    renderGames(scoreboardCache);

    if (scoreboardCache[0]?.id) {
      analyzeGame(scoreboardCache[0].id);
    }
  } catch (error) {
    console.error(error);
    statusEl.textContent = 'Error cargando datos reales';
    gamesEl.innerHTML = '<div class="loading">No se pudo cargar la prueba real.</div>';
  }
}

gamesEl.addEventListener('click', event => {
  const btn = event.target.closest('[data-game-id]');
  if (!btn) return;
  analyzeGame(btn.dataset.gameId);
});

loadGames();
