'use strict';

// localization
[...document.querySelectorAll('[data-i18n]')].forEach(e => {
  e[e.dataset.i18nValue || 'textContent'] = chrome.i18n.getMessage(e.dataset.i18n);
});

const info = document.getElementById('info');
const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const warning = e => {
  e.returnValue = 'Changes you made are not saved';
  return true;
};

const prefs = {
  timeout: 60, // seconds
  close: 0, // seconds
  message: '',
  redirect: '',
  blocked: [],
  sha256: '',
  password: '', // deprecated
  wrong: 1, // minutes
  title: true,
  reverse: false,
  map: {},
  schedule: {
    time: {
      start: '',
      end: ''
    },
    days
  },
  schedules: {},
  initialBlock: true
};

const list = document.getElementById('list');
const wildcard = h => {
  if (h.indexOf('://') === -1 && h.startsWith('R:') === false) {
    return `*://${h}/*`;
  }
  return h;
};

function add(hostname) {
  const template = document.querySelector('#list template');
  const node = document.importNode(template.content, true);
  const div = node.querySelector('div');
  div.dataset.pattern = node.querySelector('[data-id=href]').textContent = wildcard(hostname);
  div.dataset.hostname = hostname;
  const rd = node.querySelector('input');
  rd.value = prefs.map[hostname] || '';
  rd.disabled = hostname.indexOf('*') !== -1;
  node.querySelector('[data-cmd="remove"]').value = chrome.i18n.getMessage('options_remove');
  document.getElementById('rules-container').appendChild(node);
  list.dataset.visible = true;

  return rd;
}

document.getElementById('add').addEventListener('submit', e => {
  e.preventDefault();
  const hostname = e.target.querySelector('input[type=text]').value;
  if (hostname) {
    add(hostname);
  }
});

const init = (table = true) => chrome.storage.local.get(prefs, ps => {
  Object.assign(prefs, ps);
  if (table) {
    prefs.blocked.forEach(add);
  }
  document.getElementById('title').checked = prefs.title;
  document.getElementById('initialBlock').checked = prefs.initialBlock;
  document.getElementById('reverse').checked = prefs.reverse;
  document.getElementById('timeout').value = prefs.timeout;
  document.getElementById('close').value = prefs.close;
  document.getElementById('wrong').value = prefs.wrong;
  document.getElementById('message').value = prefs.message;
  document.getElementById('redirect').value = prefs.redirect;
  document.querySelector('#schedule [name=start]').value = prefs.schedule.time.start;
  document.querySelector('#schedule [name=end]').value = prefs.schedule.time.end;
  document.querySelector('#schedule [name=days]').value = prefs.schedule.days.join(', ');
  document.querySelector('#schedule [name=hostname]').value = '';

  const safe = prefs.password !== '' || prefs.sha256 !== '';
  document.querySelector('[data-cmd=unlock]').disabled = safe === false;
  document.querySelector('[data-cmd="save"]').disabled = safe;
  document.querySelector('[data-cmd="export"]').disabled = safe;
  document.querySelector('[data-cmd="import-json"]').disabled = safe;
  document.getElementById('rules').textContent = '';
  for (const rule of Object.keys(prefs.schedules)) {
    const option = document.createElement('option');
    option.value = rule;
    document.getElementById('rules').appendChild(option);
  }
});
init();

document.querySelector('#schedule [name="hostname"]').addEventListener('input', e => {
  const schedule = prefs.schedules[e.target.value];
  if (schedule) {
    document.querySelector('#schedule [name=start]').value = schedule.time.start;
    document.querySelector('#schedule [name=end]').value = schedule.time.end;
    document.querySelector('#schedule [name=days]').value = schedule.days.join(', ');
  }
});

document.addEventListener('click', async e => {
  const {target} = e;
  const cmd = target.dataset.cmd;
  if (cmd === 'remove') {
    target.closest('div').remove();
  }
  else if (cmd === 'unlock') {
    const password = document.getElementById('password').value;
    chrome.runtime.sendMessage({
      method: 'check-password',
      password
    }, resp => {
      document.querySelector('[data-cmd="unlock"]').disabled = resp;
      document.querySelector('[data-cmd="save"]').disabled = !resp;
      document.querySelector('[data-cmd="export"]').disabled = !resp;
      document.querySelector('[data-cmd="import-json"]').disabled = !resp;
      if (!resp) {
        document.getElementById('password').focus();
      }
    });
  }
  else if (cmd === 'save') {
    let schedule = {
      time: {
        start: document.querySelector('#schedule [name=start]').value,
        end: document.querySelector('#schedule [name=end]').value
      },
      days: document.querySelector('#schedule [name=days]').value.split(/\s*,\s*/)
        .map(s => {
          return days.filter(d => s.trim().toLowerCase().startsWith(d.toLowerCase())).shift();
        }).filter((s, i, l) => s && l.indexOf(s) === i)
    };
    const rule = document.querySelector('#schedule [name="hostname"]');
    if (rule.value) {
      if (schedule.days.length && schedule.time.start && schedule.time.end) {
        prefs.schedules[rule.value] = schedule;
      }
      else {
        delete prefs.schedules[rule.value];
      }
      schedule = prefs.schedule;
    }

    const password = document.getElementById('password').value;
    const sha256 = password ? await new Promise(resolve => {
      chrome.runtime.getBackgroundPage(bg => resolve(bg.sha256(password)));
    }) : '';

    // clear deprecated password preference
    chrome.storage.local.remove('password');
    chrome.storage.local.set({
      sha256,
      title: document.getElementById('title').checked,
      initialBlock: document.getElementById('initialBlock').checked,
      reverse: document.getElementById('reverse').checked,
      redirect: document.getElementById('redirect').value,
      message: document.getElementById('message').value,
      timeout: Math.max(Number(document.getElementById('timeout').value), 1),
      close: Math.max(Number(document.getElementById('close').value), 0),
      wrong: Math.max(Number(document.getElementById('wrong').value), 1),
      schedule,
      schedules: prefs.schedules,
      blocked: [...document.querySelectorAll('#rules-container > div')]
        .map(tr => tr.dataset.hostname)
        .filter((s, i, l) => s && l.indexOf(s) === i),
      map: [...document.querySelectorAll('#rules-container > div')].reduce((p, c) => {
        const {hostname} = c.dataset;
        const mapped = c.querySelector('input[type=text]').value;
        if (mapped) {
          p[hostname] = mapped;
        }
        return p;
      }, {})
    }, () => {
      info.textContent = 'Options saved';
      window.setTimeout(() => info.textContent = '', 750);
      window.removeEventListener('beforeunload', warning);
      init(false);
    });
  }
  else if (cmd === 'import-txt') {
    const input = document.createElement('input');
    input.style.display = 'none';
    input.type = 'file';
    input.accept = '.txt';
    input.acceptCharset = 'utf-8';

    document.body.appendChild(input);
    input.initialValue = input.value;
    input.onchange = () => {
      if (input.value !== input.initialValue) {
        const file = input.files[0];
        if (file.size > 100e6) {
          return console.warn('100MB backup? I don\'t believe you.');
        }
        const reader = new FileReader();
        reader.onloadend = event => {
          input.remove();
          event.target.result.split('\n').map(l => l.trim()).filter(l => l && l[0] !== '#').forEach(l => {
            const [a, b] = l.split(/\s+/);
            const rd = add(a);
            if (b) {
              rd.value = b;
            }
          });
        };
        reader.readAsText(file, 'utf-8');
      }
    };
    input.click();
  }
  else if (cmd === 'export') {
    chrome.storage.local.get(null, prefs => {
      const blob = new Blob([
        JSON.stringify(prefs, null, '\t')
      ], {type: 'application/json'});
      const href = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), {
        href,
        type: 'application/json',
        download: 'block-site-preferences.json'
      }).dispatchEvent(new MouseEvent('click'));
      setTimeout(() => URL.revokeObjectURL(href));
    });
  }
  else if (cmd == 'import-json') {
    const input = document.createElement('input');
    input.style.display = 'none';
    input.type = 'file';
    input.accept = '.json';
    input.acceptCharset = 'utf-8';

    document.body.appendChild(input);
    input.initialValue = input.value;
    input.onchange = () => {
      if (input.value !== input.initialValue) {
        const file = input.files[0];
        if (file.size > 100e6) {
          console.warn('100MB backup? I don\'t believe you.');
          return;
        }
        const reader = new FileReader();
        reader.onloadend = event => {
          input.remove();
          const json = JSON.parse(event.target.result);
          chrome.storage.local.clear(() => chrome.storage.local.set(json, () => {
            chrome.runtime.reload();
            window.close();
          }));
        };
        reader.readAsText(file, 'utf-8');
      }
    };
    input.click();
  }
  else if (cmd === 'reset') {
    if (e.detail === 1) {
      info.textContent = 'Double-click to reset!';
      window.setTimeout(() => info.textContent = '', 750);
    }
    else {
      localStorage.clear();
      chrome.storage.local.clear(() => {
        chrome.runtime.reload();
        window.close();
      });
    }
  }
});

document.getElementById('support').addEventListener('click', () => chrome.tabs.create({
  url: chrome.runtime.getManifest().homepage_url + '?rd=donate'
}));

/* change reminder */
document.addEventListener('change', () => {
  window.addEventListener('beforeunload', warning);
});

/* auto type rule */
document.getElementById('rules-container').addEventListener('click', e => {
  if (e.target.dataset.id === 'href') {
    const value = e.target.parentElement.dataset.hostname;
    if (value) {
      document.querySelector('#add input[name="hostname"]').value = value;
      document.dispatchEvent(new Event('change'));
    }
  }
});
