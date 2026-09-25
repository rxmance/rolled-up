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
    locationStatus.textContent = 'Location unavailable — add city or ZIP code instead.';
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

  setStatus('Checking current ownership and sources…');

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

  const chain = (result.ownerChain || [])
    .map((owner, index, arr) => `
      <div class="chain-item">
        <span class="owner">${escapeHtml(owner)}</span>
        ${
          index < arr.length - 1
            ? '<span class="arrow">→</span>'
            : ''
        }
      </div>
    `)
    .join('');

  const hasLocation =
    Boolean(location.city) ||
    Boolean(location.coords);

  const locationContext = location.city
    ? `Near ${escapeHtml(location.city)}`
    : 'Using your location';

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
      <div class="label">WHAT IT IS</div>

      <p>
        ${escapeHtml(
          result.classificationDetail
        )}
      </p>
    </div>

    <div class="ownership-block">
      <div class="label">OWNERSHIP</div>

      <div class="chain">
        ${chain}
      </div>
    </div>

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
