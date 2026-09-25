const form = document.querySelector('#search-form');
const queryInput = document.querySelector('#query');
const cityInput = document.querySelector('#city');
const searchButton = document.querySelector('#search-button');
const locationButton = document.querySelector('#location-button');
const locationStatus = document.querySelector('#location-status');
const statusBox = document.querySelector('#status');
const resultBox = document.querySelector('#result');

let coords = null;
let searchToken = 0;

locationButton.addEventListener('click', () => {
  if (!navigator.geolocation) {
    locationStatus.textContent =
      'Location unavailable — add city or ZIP code instead.';
    return;
  }

  locationStatus.textContent = 'Getting location…';

  navigator.geolocation.getCurrentPosition(
    pos => {
      coords = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude
      };

      cityInput.value = '';
      locationStatus.textContent = 'Using your location';
    },
    () => {
      locationStatus.textContent =
        'Could not access location — add city or ZIP code instead.';
    },
    { timeout: 8000 }
  );
});

cityInput.addEventListener('input', () => {
  if (cityInput.value.trim()) {
    coords = null;
    locationStatus.textContent = '';
  }
});

form.addEventListener('submit', async event => {
  event.preventDefault();

  const query = queryInput.value.trim();
  const city = cityInput.value.trim();

  if (!query) return;

  const token = ++searchToken;

  setStatus('Researching ownership, investors and related companies…');

  resultBox.classList.add('hidden');
  resultBox.innerHTML = '';

  searchButton.disabled = true;
  searchButton.textContent = 'Checking';

  try {
    const response = await fetch('/api/research', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query,
        city: city || undefined,
        latitude: coords?.latitude,
        longitude: coords?.longitude
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Search failed');
    }

    if (token !== searchToken) return;

    hideStatus();

    renderResult(data, {
      city,
      coords
    });

    if (city || coords) {
      loadAlternatives(
        data.businessName || query,
        {
          city,
          coords,
          token
        }
      );
    }
  } catch (error) {
    if (token === searchToken) {
      setStatus(
        error.message || 'Search failed.',
        true
      );
    }
  } finally {
    if (token === searchToken) {
      searchButton.disabled = false;
      searchButton.textContent = 'Search';
    }
  }
});

function renderResult(result, location) {
  const sources = (result.sources || [])
    .map(source => `
      <a
        class="source"
        href="${escapeAttr(source.url)}"
        target="_blank"
        rel="noreferrer"
      >
        ${escapeHtml(source.publisher || source.title)}
        <span class="ext">↗</span>
      </a>
    `)
    .join('');

  const chain = Array.isArray(result.ownerChain)
    ? result.ownerChain.filter(Boolean)
    : [];

  const investors = Array.isArray(result.keyInvestors)
    ? result.keyInvestors.filter(Boolean)
    : [];

  const relatedBusinesses =
    Array.isArray(result.relatedBusinesses)
      ? result.relatedBusinesses.filter(Boolean)
      : [];

  const hasLocation =
    Boolean(location.city) ||
    Boolean(location.coords);

  const locationContext = location.city
    ? `Near ${escapeHtml(location.city)}`
    : 'Using your location';

  const factSections = [];

  if (chain.length) {
    factSections.push(
      makeFact(
        ownershipLabel(result.classification),
        chain.join(' → ')
      )
    );
  }

  if (result.moneyRaised) {
    factSections.push(
      makeFact(
        moneyLabel(result.classification),
        result.moneyRaised
      )
    );
  }

  if (investors.length) {
    factSections.push(
      makeFact(
        'KEY INVESTORS',
        formatList(investors)
      )
    );
  }

  if (relatedBusinesses.length) {
    factSections.push(
      makeFact(
        relatedLabel(result.classification),
        formatList(relatedBusinesses)
      )
    );
  }

  if (result.founderOperator) {
    factSections.push(
      makeFact(
        founderLabel(result.classification),
        result.founderOperator
      )
    );
  }

  resultBox.innerHTML = `
    <div class="result-header">
      <div>
        <div class="result-meta">
          ${escapeHtml(
            result.locationLabel ||
            'CURRENT OWNERSHIP'
          )}
        </div>

        <h2>
          ${escapeHtml(result.businessName)}
        </h2>
      </div>

      <div class="type-badge">
        ${escapeHtml(result.classification)}
      </div>
    </div>

    <div class="primary-answer">
      <div class="label">WHAT IT MEANS</div>

      <p>
        ${escapeHtml(
          result.classificationDetail
        )}
      </p>
    </div>

    ${
      factSections.length
        ? `
          <div class="ownership-facts">
            ${factSections.join('')}
          </div>
        `
        : ''
    }

    <section class="alternatives-section">
      <h3>
        INDEPENDENT BUSINESSES LIKE THIS NEAR YOU
      </h3>

      ${
        hasLocation
          ? `
            <p
              id="alt-context"
              class="alt-context"
            >
              ${locationContext}
            </p>

            <div
              id="alt-list"
              class="alt-list"
            >
              <div class="alt-loading">
                Finding independent businesses…
              </div>
            </div>
          `
          : `
            <p class="add-city">
              Add a city or ZIP code above to see
              independent businesses near you.
            </p>
          `
      }
    </section>

    <div class="sources-block">
      <div class="sources-header">
        <span class="label">
          SOURCES
        </span>

        <span class="confidence">
          Confidence:
          ${escapeHtml(
            result.confidence || 'Low'
          )}
        </span>
      </div>

      <div class="sources">
        ${
          sources ||
          '<span class="confidence">No source links available.</span>'
        }
      </div>
    </div>
  `;

  resultBox.classList.remove('hidden');
}

function makeFact(label, value) {
  if (!value) return '';

  return `
    <div class="ownership-block fact-block">
      <div class="label">
        ${escapeHtml(label)}
      </div>

      <div class="fact-value">
        ${escapeHtml(value)}
      </div>
    </div>
  `;
}

function ownershipLabel(classification) {
  switch (classification) {
    case 'PUBLIC COMPANY':
      return 'OWNERSHIP';

    case 'CORPORATE OWNED':
      return 'OWNED BY';

    case 'PRIVATE EQUITY':
      return 'OWNED / BACKED BY';

    case 'VENTURE BACKED':
      return 'WHO OWNS IT';

    case 'RESTAURANT / HOSPITALITY GROUP':
      return 'OWNERSHIP / GROUP';

    case 'FRANCHISE':
      return 'FRANCHISE / OWNERSHIP';

    default:
      return 'OWNERSHIP';
  }
}

function moneyLabel(classification) {
  if (classification === 'VENTURE BACKED') {
    return 'MONEY RAISED';
  }

  if (classification === 'PRIVATE EQUITY') {
    return 'INVESTMENT';
  }

  return 'DEAL / FUNDING';
}

function relatedLabel(classification) {
  if (
    classification ===
    'RESTAURANT / HOSPITALITY GROUP'
  ) {
    return 'RELATED RESTAURANTS';
  }

  return 'RELATED BUSINESSES';
}

function founderLabel(classification) {
  if (
    classification ===
    'RESTAURANT / HOSPITALITY GROUP'
  ) {
    return 'KEY PEOPLE';
  }

  return 'FOUNDED / OPERATED BY';
}

function formatList(items) {
  if (!items.length) return '';

  if (items.length === 1) {
    return items[0];
  }

  if (items.length === 2) {
    return `${items[0]} + ${items[1]}`;
  }

  return `${items
    .slice(0, -1)
    .join(', ')} + ${items[items.length - 1]}`;
}

async function loadAlternatives(
  businessName,
  {
    city,
    coords,
    token
  }
) {
  const list =
    document.querySelector('#alt-list');

  if (!list) return;

  try {
    const response =
      await fetch('/api/alternatives', {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json'
        },
        body: JSON.stringify({
          businessName,
          city: city || undefined,
          latitude: coords?.latitude,
          longitude: coords?.longitude
        })
      });

    const data = await response.json();

    if (token !== searchToken) return;

    const alternatives =
      Array.isArray(data.alternatives)
        ? data.alternatives
        : [];

    if (!alternatives.length) {
      list.innerHTML = `
        <div class="no-alt">
          No confidently independent
          businesses found nearby yet.
        </div>
      `;

      return;
    }

    list.innerHTML = alternatives
      .map(alt => `
        <a
          class="alt-item"
          href="${escapeAttr(
            alt.url || '#'
          )}"
          ${
            alt.url
              ? 'target="_blank" rel="noreferrer"'
              : ''
          }
        >
          <div>
            <div class="alt-name">
              ${escapeHtml(alt.name)}
            </div>

            <span class="alt-location">
              ${escapeHtml(
                alt.location || ''
              )}
            </span>

            <p class="alt-reason">
              ${escapeHtml(
                alt.reason || ''
              )}
            </p>
          </div>

          ${
            alt.url
              ? '<span class="ext">↗</span>'
              : ''
          }
        </a>
      `)
      .join('');
  } catch {
    if (token === searchToken) {
      list.innerHTML = `
        <div class="no-alt">
          No confidently independent
          businesses found nearby yet.
        </div>
      `;
    }
  }
}

function setStatus(
  message,
  isError = false
) {
  statusBox.textContent = message;

  statusBox.className =
    `status${isError ? ' error' : ''}`;
}

function hideStatus() {
  statusBox.className =
    'status hidden';

  statusBox.textContent = '';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(
      /[&<>'"]/g,
      char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[char])
    );
}

function escapeAttr(value) {
  return escapeHtml(value);
}
