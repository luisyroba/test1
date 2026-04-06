const demoGames = [
  {
    id: 'game-1',
    awayName: 'Boston Celtics',
    homeName: 'Miami Heat',
    gameTime: 'Hoy · 20:30',
    stats: {
      awayEdge: 8.4,
      homeEdge: 5.8,
      projectedSpread: -4.5,
      projectedTotal: 221.5,
      awayAvailabilityPenalty: 0.2,
      homeAvailabilityPenalty: 1.0,
      summary: 'Boston llega mejor por récord, diferencial reciente, consistencia defensiva y mejor forma global.',
      factors: [
        'Récord superior y mejor diferencial ajustado',
        'Mejor forma reciente vs rivales fuertes',
        'Miami con una baja importante en rotación'
      ]
    },
    lineup: {
      away: {
        starters: ['Jrue Holiday', 'Derrick White', 'Jaylen Brown', 'Jayson Tatum', 'Kristaps Porzingis'],
        availability: ['Brown: Probable', 'Porzingis: Disponible']
      },
      home: {
        starters: ['Terry Rozier', 'Tyler Herro', 'Jimmy Butler', 'Nikola Jovic', 'Bam Adebayo'],
        availability: ['Butler: Questionable', 'Love: Out']
      }
    },
    oddsEvent: {
      bookmakers: [
        {
          key: 'betano',
          title: 'Betano',
          markets: [
            {
              key: 'h2h',
              outcomes: [
                { name: 'Boston Celtics', price: 1.57 },
                { name: 'Miami Heat', price: 2.45 }
              ]
            },
            {
              key: 'spreads',
              outcomes: [
                { name: 'Boston Celtics', point: -6.5, price: 1.72 },
                { name: 'Miami Heat', point: 6.5, price: 2.02 }
              ]
            },
            {
              key: 'totals',
              outcomes: [
                { name: 'Over', point: 224.5, price: 1.87 },
                { name: 'Under', point: 224.5, price: 1.87 }
              ]
            }
          ]
        }
      ]
    }
  },
  {
    id: 'game-2',
    awayName: 'Phoenix Suns',
    homeName: 'Dallas Mavericks',
    gameTime: 'Hoy · 22:00',
    stats: {
      awayEdge: 6.2,
      homeEdge: 6.0,
      projectedSpread: 0.5,
      projectedTotal: 238.5,
      awayAvailabilityPenalty: 0.4,
      homeAvailabilityPenalty: 0.2,
      summary: 'Partido más equilibrado por lado, pero el ritmo y la eficiencia ofensiva empujan hacia el total.',
      factors: [
        'Dos ataques con alto volumen de triples',
        'Poca separación en el lado',
        'Modelo proyecta total por encima de la línea base'
      ]
    },
    lineup: {
      away: {
        starters: ['Tyus Jones', 'Devin Booker', 'Bradley Beal', 'Kevin Durant', 'Jusuf Nurkic'],
        availability: ['Beal: Probable']
      },
      home: {
        starters: ['Luka Doncic', 'Kyrie Irving', 'Josh Green', 'P.J. Washington', 'Dereck Lively II'],
        availability: ['Lively II: Available']
      }
    },
    oddsEvent: {
      bookmakers: [
        {
          key: 'bet365',
          title: 'bet365',
          markets: [
            {
              key: 'h2h',
              outcomes: [
                { name: 'Phoenix Suns', price: 2.05 },
                { name: 'Dallas Mavericks', price: 1.78 }
              ]
            },
            {
              key: 'spreads',
              outcomes: [
                { name: 'Phoenix Suns', point: 2.5, price: 1.80 },
                { name: 'Dallas Mavericks', point: -2.5, price: 1.91 }
              ]
            },
            {
              key: 'totals',
              outcomes: [
                { name: 'Over', point: 232.5, price: 1.83 },
                { name: 'Under', point: 232.5, price: 1.83 }
              ]
            }
          ]
        }
      ]
    }
  }
];

const BOOKMAKER_PRIORITY = ['betano', 'novibet', 'bet365', 'bet365_uk'];

function normalizeString(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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

function formatOddsDecimal(value) {
  const n = Number(value);
  return Number.isNaN(n) ? '-' : n.toFixed(2);
}

function isMinimumPlayableOdds(odds) {
  const n = Number(odds);
  return !Number.isNaN(n) && n >= 1.5;
}

function getBookmakerPriorityIndex(key) {
  const idx = BOOKMAKER_PRIORITY.indexOf(String(key || '').toLowerCase());
  return idx === -1 ? 999 : idx;
}

function sortBookmakersByPriority(bookmakers) {
  return [...(bookmakers || [])].sort((a, b) => getBookmakerPriorityIndex(a.key) - getBookmakerPriorityIndex(b.key));
}

function findOutcomeByTeamName(outcomes, teamName) {
  const target = normalizeString(teamName);
  return (outcomes || []).find(outcome => normalizeString(outcome?.name) === target) || null;
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
        return { selection, strength, reason: `${awayName} es el lado que mejor respalda la lectura conjunta de estadísticas y disponibilidad.` };
      }
    }
  }

  if (adjustedHomeEdge >= adjustedAwayEdge + 0.75) {
    const selection = selectSideRecommendation(oddsEvent.bookmakers, homeName, Math.abs(projectedSpread));
    if (selection && isMinimumPlayableOdds(selection.odds)) {
      const strength = classifyBetStrength(edgeGap, selection.odds, contextPenalty);
      if (strength.level !== 'No bet') {
        return { selection, strength, reason: `${homeName} es el lado que mejor respalda la lectura conjunta de estadísticas y disponibilidad.` };
      }
    }
  }

  const totalSelection = selectTotalRecommendation(oddsEvent.bookmakers, projectedTotal);
  if (totalSelection && isMinimumPlayableOdds(totalSelection.odds)) {
    const strength = classifyBetStrength(Math.max(1.35, edgeGap), totalSelection.odds, contextPenalty);
    if (strength.level !== 'No bet') {
      return { selection: totalSelection, strength, reason: 'Como el lado está equilibrado, el mejor ángulo aparece en el total.' };
    }
  }

  return makeNoBet('No hay una opción que combine respaldo estadístico suficiente con cuota mínima 1.50.');
}

function renderLineup(teamName, lineup) {
  return `
    <div class="lineup-card">
      <h4>${escapeHtml(teamName)}</h4>
      <div class="subhead">Titulares esperados</div>
      <ul>${lineup.starters.map(player => `<li>${escapeHtml(player)}</li>`).join('')}</ul>
      <div class="subhead">Availability</div>
      <ul>${lineup.availability.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </div>
  `;
}

function renderRecommendation(rec) {
  if (!rec.selection) {
    return `
      <div class="pick-card nobet">
        <div class="eyebrow">Recomendación</div>
        <div class="pick-main">No bet</div>
        <p>${escapeHtml(rec.reason)}</p>
      </div>
    `;
  }

  return `
    <div class="pick-card">
      <div class="eyebrow">Recomendación</div>
      <div class="pick-main">${escapeHtml(rec.selection.label)}</div>
      <div class="pick-meta">
        <span>${escapeHtml(rec.selection.marketLabel)}</span>
        <span>Cuota ${escapeHtml(formatOddsDecimal(rec.selection.odds))}</span>
        <span>${escapeHtml(rec.strength.level)} · ${escapeHtml(rec.strength.stake)}</span>
        <span>${escapeHtml(rec.selection.bookmakerTitle || 'Casa')}</span>
      </div>
      <p>${escapeHtml(rec.reason)}</p>
      ${rec.selection.isEstimated && rec.selection.derivedFromLabel ? `<div class="derived">Basado en línea principal: ${escapeHtml(rec.selection.derivedFromLabel)}</div>` : ''}
    </div>
  `;
}

function renderGame(game) {
  const rec = buildOddsRecommendation({
    oddsEvent: game.oddsEvent,
    awayName: game.awayName,
    homeName: game.homeName,
    awayEdge: game.stats.awayEdge,
    homeEdge: game.stats.homeEdge,
    projectedTotal: game.stats.projectedTotal,
    projectedSpread: game.stats.projectedSpread,
    awayAvailabilityPenalty: game.stats.awayAvailabilityPenalty,
    homeAvailabilityPenalty: game.stats.homeAvailabilityPenalty
  });

  return `
    <article class="game-card">
      <div class="game-top">
        <div>
          <h2>${escapeHtml(game.awayName)} vs ${escapeHtml(game.homeName)}</h2>
          <div class="time">${escapeHtml(game.gameTime)}</div>
        </div>
        <div class="projection">
          <span>Spread proj: ${escapeHtml(String(game.stats.projectedSpread))}</span>
          <span>Total proj: ${escapeHtml(String(game.stats.projectedTotal))}</span>
        </div>
      </div>

      ${renderRecommendation(rec)}

      <div class="summary-box">
        <div class="eyebrow">Lectura estadística</div>
        <p>${escapeHtml(game.stats.summary)}</p>
        <ul>${game.stats.factors.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
      </div>

      <div class="lineups-grid">
        ${renderLineup(game.awayName, game.lineup.away)}
        ${renderLineup(game.homeName, game.lineup.home)}
      </div>
    </article>
  `;
}

document.getElementById('app').innerHTML = demoGames.map(renderGame).join('');
