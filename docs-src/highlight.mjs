// Colour for code blocks, in about as few rules as colour can be had.
//
// A real highlighter understands the language. This one understands four
// things — comments, strings, numbers and a list of words — because that is
// what the design asks for, and because a highlighter that guesses further
// gets a shell script wrong in a way a reader then trusts. Anything it does
// not recognise leaves as plain escaped text, which is what the whole block
// was before.
//
// The scanner never drops or reorders a character: every character of the
// input leaves through exactly one branch, so what is on the screen is what
// is in the Markdown. `verify` in check-links.mjs re-reads that claim.

const LANGUAGES = {
  bash: {
    label: 'bash',
    line: ['#'],
    strings: ["'", '"'],
    keywords: [
      'if', 'then', 'else', 'elif', 'fi', 'for', 'in', 'do', 'done', 'while',
      'case', 'esac', 'function', 'return', 'exit', 'export', 'local', 'set',
      'sudo', 'cd', 'echo', 'cat', 'curl', 'docker', 'systemctl', 'npm',
      'node', 'git', 'apt', 'ufw', 'openssl', 'chmod', 'chown', 'mkdir',
      'cp', 'mv', 'rm', 'source', 'tee', 'ssh', 'tar'
    ]
  },
  ts: {
    label: 'TypeScript',
    line: ['//'],
    block: ['/*', '*/'],
    strings: ["'", '"', '`'],
    keywords: [
      'import', 'from', 'export', 'default', 'const', 'let', 'var',
      'function', 'return', 'if', 'else', 'for', 'while', 'await', 'async',
      'new', 'class', 'extends', 'implements', 'interface', 'type', 'enum',
      'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'true',
      'false', 'null', 'undefined', 'this', 'switch', 'case', 'break',
      'continue', 'of', 'as', 'satisfies', 'void'
    ]
  },
  json: {
    label: 'json',
    strings: ['"'],
    keywords: ['true', 'false', 'null'],
    properties: true
  },
  powershell: {
    label: 'PowerShell',
    line: ['#'],
    strings: ["'", '"'],
    keywords: [
      'if', 'else', 'elseif', 'foreach', 'function', 'param', 'return',
      'try', 'catch', 'finally', 'throw', 'New-Item', 'Get-Content',
      'Set-Content', 'Register-ScheduledTask', 'New-ScheduledTaskAction',
      'New-ScheduledTaskTrigger', 'New-ScheduledTaskPrincipal',
      'Start-Process', 'Invoke-WebRequest', 'Test-Path', 'Remove-Item',
      'Copy-Item', 'Get-Service', 'Restart-Service'
    ]
  },
  sql: {
    label: 'sql',
    line: ['--'],
    strings: ["'"],
    insensitive: true,
    keywords: [
      'select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set',
      'delete', 'create', 'table', 'index', 'alter', 'drop', 'join', 'left',
      'inner', 'on', 'order', 'by', 'group', 'having', 'limit', 'and', 'or',
      'not', 'null', 'primary', 'key', 'references', 'distinct', 'as'
    ]
  },
  lua: {
    label: 'lua',
    line: ['--'],
    strings: ["'", '"'],
    keywords: [
      'local', 'function', 'end', 'if', 'then', 'else', 'elseif', 'for',
      'while', 'do', 'return', 'nil', 'true', 'false', 'and', 'or', 'not',
      'require'
    ]
  },
  caddyfile: {
    label: 'Caddyfile',
    line: ['#'],
    strings: ['"'],
    keywords: [
      'tls', 'internal', 'reverse_proxy', 'encode', 'header', 'route',
      'handle', 'respond', 'file_server', 'log'
    ]
  },
  nginx: {
    label: 'nginx',
    line: ['#'],
    strings: ["'", '"'],
    keywords: [
      'server', 'listen', 'location', 'proxy_pass', 'proxy_set_header',
      'server_name', 'ssl_certificate', 'ssl_certificate_key', 'return',
      'include', 'upstream', 'client_max_body_size', 'proxy_http_version',
      'proxy_read_timeout', 'http', 'events'
    ]
  }
};

// What a fence may be written as, against what it is.
const ALIASES = {
  sh: 'bash', shell: 'bash', console: 'bash', zsh: 'bash',
  typescript: 'ts', javascript: 'ts', js: 'ts', tsx: 'ts', mjs: 'ts',
  ps1: 'powershell', pwsh: 'powershell',
  postgresql: 'sql', psql: 'sql',
  caddy: 'caddyfile'
};

export function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// The name the code block's header bar shows. An unlabelled fence gets no
// label rather than a guessed one: most of them are output, not a language.
export function languageLabel(lang) {
  const key = normalise(lang);
  return key ? LANGUAGES[key].label : '';
}

function normalise(lang) {
  if (!lang) return null;
  const key = String(lang).trim().toLowerCase().split(/\s+/)[0];
  const resolved = ALIASES[key] ?? key;
  return LANGUAGES[resolved] ? resolved : null;
}

const WORD = /[A-Za-z0-9_$-]/;
const DIGIT = /[0-9]/;

export function highlight(code, lang) {
  const key = normalise(lang);
  if (!key) return escapeHtml(code);

  const rules = LANGUAGES[key];
  const keywords = new Set(
    rules.insensitive ? rules.keywords.map(word => word.toLowerCase()) : rules.keywords
  );
  const out = [];
  let plain = '';

  const flush = () => {
    if (plain) {
      out.push(escapeHtml(plain));
      plain = '';
    }
  };
  const emit = (cls, text) => {
    flush();
    out.push(`<span class="tok-${cls}">${escapeHtml(text)}</span>`);
  };

  let i = 0;
  while (i < code.length) {
    const rest = code.slice(i);

    const lineStart = (rules.line ?? []).find(marker => rest.startsWith(marker));
    if (lineStart) {
      const end = code.indexOf('\n', i);
      const stop = end === -1 ? code.length : end;
      emit('comment', code.slice(i, stop));
      i = stop;
      continue;
    }

    if (rules.block && rest.startsWith(rules.block[0])) {
      const end = code.indexOf(rules.block[1], i + rules.block[0].length);
      const stop = end === -1 ? code.length : end + rules.block[1].length;
      emit('comment', code.slice(i, stop));
      i = stop;
      continue;
    }

    const quote = (rules.strings ?? []).find(mark => rest.startsWith(mark));
    if (quote) {
      let j = i + 1;
      // A single quote in these languages takes no escapes; the others do,
      // and a backslash before the closing quote must not end the string.
      const escapes = quote !== "'";
      while (j < code.length) {
        if (escapes && code[j] === '\\') { j += 2; continue; }
        if (code[j] === quote) { j += 1; break; }
        if (code[j] === '\n' && quote !== '`') { break; }
        j += 1;
      }
      const text = code.slice(i, j);
      const isProperty =
        rules.properties && /^\s*:/.test(code.slice(j));
      emit(isProperty ? 'prop' : 'string', text);
      i = j;
      continue;
    }

    const char = code[i];
    if (DIGIT.test(char) && !WORD.test(code[i - 1] ?? ' ')) {
      let j = i;
      while (j < code.length && /[0-9._]/.test(code[j])) j += 1;
      emit('number', code.slice(i, j));
      i = j;
      continue;
    }

    if (WORD.test(char)) {
      let j = i;
      while (j < code.length && WORD.test(code[j])) j += 1;
      const word = code.slice(i, j);
      const lookup = rules.insensitive ? word.toLowerCase() : word;
      if (keywords.has(lookup)) emit('keyword', word);
      else plain += word;
      i = j;
      continue;
    }

    plain += char;
    i += 1;
  }

  flush();
  return out.join('');
}
