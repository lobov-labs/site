(function () {
  // GCP project number of the extension's OAuth client. With it, a file picked here is
  // granted to the extension under the narrow drive.file scope.
  const APP_ID = '810403428109';

  const params = new URLSearchParams(window.location.search);
  const extId = /^[a-p]{32}$/.test(params.get('ext') || '') ? params.get('ext') : null;
  const lang = params.get('lang') === 'ru' ? 'ru' : 'en';

  // The fragment is read once and dropped from the address bar straight away.
  // 2.3.0+ passes a one-off session id ("s=…") and the token is fetched from the
  // extension below; 2.2.6 and older put the token itself there.
  const hash = window.location.hash.slice(1);
  history.replaceState(null, '', window.location.pathname + window.location.search);
  const session = hash.startsWith('s=') ? hash.slice(2) : null;
  const legacyToken = !session && hash ? decodeURIComponent(hash) : null;

  const T = {
    ru: {
      loading:    'Загрузка…',
      loadPicker: 'Загрузка Google Picker…',
      opening:    'Открываем выбор файла…',
      checking:   'Проверяем доступ…',
      readOnly:   'Таблица доступна только для чтения. Выберите ту, в которую можно писать.',
      noParams:   'Отсутствуют параметры расширения. Откройте выбор таблицы из настроек расширения.',
      apiError:   'Не удалось загрузить Google API.',
      backBtn:    '← Выбрать другой файл',
    },
    en: {
      loading:    'Loading…',
      loadPicker: 'Loading Google Picker…',
      opening:    'Opening picker…',
      checking:   'Checking access…',
      readOnly:   'This spreadsheet is read-only. Please select one you can edit.',
      noParams:   'Missing extension parameters. Open the spreadsheet picker from the extension settings.',
      apiError:   'Failed to load Google API.',
      backBtn:    '← Try another file',
    }
  };

  function t(k) { return T[lang][k]; }

  let token = null;
  let picker;

  document.getElementById('msg').textContent = t('loading');
  document.getElementById('backBtn').textContent = t('backBtn');

  function hasRuntime() {
    return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage;
  }

  function sendToExtension(message) {
    return new Promise((resolve) => {
      if (!hasRuntime()) { resolve(null); return; }
      try {
        chrome.runtime.sendMessage(extId, session ? { ...message, session } : message, (resp) => {
          void chrome.runtime.lastError;
          resolve(resp || null);
        });
      } catch (e) { resolve(null); }
    });
  }

  async function start() {
    if (!extId || (!session && !legacyToken)) { showError(t('noParams')); return; }
    if (legacyToken) {
      token = legacyToken;
    } else {
      const resp = await sendToExtension({ type: 'GET_PICKER_TOKEN' });
      token = resp && resp.ok ? resp.token : null;
    }
    if (!token) { showError(t('noParams')); return; }
    loadPicker();
  }

  function loadPicker() {
    document.getElementById('msg').textContent = t('loadPicker');
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.onload = () => gapi.load('picker', createPicker);
    script.onerror = () => showError(t('apiError'));
    document.head.appendChild(script);
  }

  function createPicker() {
    document.getElementById('msg').textContent = t('opening');

    const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
      .setIncludeFolders(false)
      .setSelectFolderEnabled(false);

    picker = new google.picker.PickerBuilder()
      .addView(view)
      .setAppId(APP_ID)
      .setOAuthToken(token)
      .setDeveloperKey(window.PICKER_API_KEY)
      .setCallback(pickerCallback)
      .build();

    picker.setVisible(true);

    document.getElementById('backBtn').addEventListener('click', () => {
      document.getElementById('backBtn').style.display = 'none';
      document.getElementById('spinner').style.display = '';
      document.getElementById('msg').className = '';
      document.getElementById('msg').textContent = t('opening');
      document.getElementById('state').style.display = 'none';
      picker.setVisible(true);
    });

    setTimeout(() => {
      document.getElementById('state').style.display = 'none';
    }, 600);
  }

  async function pickerCallback(data) {
    if (data.action === google.picker.Action.PICKED) {
      const doc = data.docs[0];
      document.getElementById('state').style.display = 'flex';
      document.getElementById('spinner').style.display = '';
      document.getElementById('backBtn').style.display = 'none';
      document.getElementById('msg').className = '';
      document.getElementById('msg').textContent = t('checking');
      try {
        const resp = await fetch(
          'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(doc.id) + '?fields=capabilities.canEdit',
          { headers: { Authorization: 'Bearer ' + token } }
        );
        if (resp.ok) {
          const json = await resp.json();
          if (json.capabilities && json.capabilities.canEdit === false) {
            showError(t('readOnly'));
            return;
          }
        }
      } catch (e) {
        // proceed, let Sheets API handle access errors
      }
      await sendToExtension({ type: 'PICKER_SELECTED', fileId: doc.id, fileName: doc.name });
      token = null;
      window.close();
    } else if (data.action === google.picker.Action.CANCEL) {
      await sendToExtension({ type: 'PICKER_CANCEL' });
      token = null;
      window.close();
    }
  }

  function showError(msg) {
    document.getElementById('spinner').style.display = 'none';
    const el = document.getElementById('msg');
    el.className = 'error';
    el.textContent = msg;
    document.getElementById('backBtn').style.display = picker ? 'inline-block' : 'none';
  }

  start();
})();
