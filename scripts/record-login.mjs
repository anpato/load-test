import { chromium } from 'playwright';

const loginURL = process.argv[2];
if (!loginURL) {
  process.stderr.write('Usage: node record-login.mjs <login-url>\n');
  process.exit(1);
}

const steps = [];

function buildInitScript() {
  return `
    (function() {
      if (window.__recorderInstalled) return;
      window.__recorderInstalled = true;

      function isStableId(id) {
        if (!id) return false;
        if (/^:r\w+:/.test(id)) return false;
        if (/^react-/.test(id)) return false;
        if (/^radix-/.test(id)) return false;
        if (/^headlessui-/.test(id)) return false;
        if (/^mui-/.test(id)) return false;
        if (/[0-9a-f]{8,}/.test(id)) return false;
        if (/^\d+$/.test(id)) return false;
        if (/^ember\d+/.test(id)) return false;
        if (/--\d+$/.test(id)) return false;
        return true;
      }

      function cssSelector(el) {
        if (!el || !el.tagName) return null;
        var tag = el.tagName.toLowerCase();

        // Stable test attributes (highest priority)
        var testId = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy');
        if (testId) return '[data-testid="' + CSS.escape(testId) + '"]';

        // Name attribute on form elements
        if ((tag === 'input' || tag === 'textarea' || tag === 'select') && el.name)
          return tag + '[name="' + CSS.escape(el.name) + '"]';

        // Stable IDs only (skip framework-generated dynamic IDs)
        if (el.id && isStableId(el.id)) return '#' + CSS.escape(el.id);

        // ARIA attributes
        if (el.getAttribute('aria-label'))
          return tag + '[aria-label="' + CSS.escape(el.getAttribute('aria-label')) + '"]';

        // Role-based selectors
        var role = el.getAttribute('role');
        if (role) {
          var roleText = el.textContent.trim().substring(0, 30);
          if (roleText) return '[role="' + role + '"]';
        }

        // Input type + placeholder combo
        if (tag === 'input' && el.placeholder)
          return 'input[placeholder="' + CSS.escape(el.placeholder) + '"]';

        // Input by type (with nth-of-type if ambiguous)
        if (tag === 'input' && el.type && el.type !== 'text') {
          var sameType = document.querySelectorAll('input[type="' + el.type + '"]');
          if (sameType.length === 1) return 'input[type="' + el.type + '"]';
          var typeIdx = Array.from(sameType).indexOf(el);
          return 'input[type="' + el.type + '"]:nth-of-type(' + (typeIdx + 1) + ')';
        }

        // Button by text content
        if (tag === 'button' || (el.getAttribute('type') === 'submit')) {
          var btnText = el.textContent.trim().substring(0, 40);
          if (btnText) {
            var matches = document.querySelectorAll(tag);
            var textMatches = Array.from(matches).filter(function(b) {
              return b.textContent.trim().substring(0, 40) === btnText;
            });
            if (textMatches.length === 1) return 'text="' + btnText + '"';
          }
        }

        // Link by text
        if (tag === 'a') {
          var linkText = el.textContent.trim().substring(0, 40);
          if (linkText) return 'a >> text="' + linkText + '"';
        }

        // Positional fallback
        var parent = el.parentElement;
        if (parent) {
          var siblings = Array.from(parent.children).filter(function(c) { return c.tagName === el.tagName; });
          if (siblings.length > 1) {
            var idx = siblings.indexOf(el) + 1;
            var parentSel = cssSelector(parent);
            if (parentSel) return parentSel + ' > ' + tag + ':nth-of-type(' + idx + ')';
          }
        }

        return tag;
      }

      var pendingInput = null;

      document.addEventListener('focusin', function(e) {
        var el = e.target;
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
          pendingInput = { el: el, selector: cssSelector(el), startValue: el.value };
        }
      }, true);

      function flushPendingInput() {
        if (!pendingInput) return;
        var val = pendingInput.el.value;
        if (val && val !== pendingInput.startValue) {
          window.__pushStep(JSON.stringify({
            selector: pendingInput.selector,
            action: 'fill',
            value: val
          }));
        }
        pendingInput = null;
      }

      document.addEventListener('focusout', function(e) {
        if (pendingInput && pendingInput.el === e.target) {
          flushPendingInput();
        }
      }, true);

      document.addEventListener('click', function(e) {
        var el = e.target;
        var clickable = el.closest('button, a, input[type="submit"], input[type="button"], [role="button"]');
        if (!clickable) return;

        flushPendingInput();

        var sel = cssSelector(clickable);
        if (sel) {
          window.__pushStep(JSON.stringify({
            selector: sel,
            action: 'click'
          }));
        }
      }, true);

      document.addEventListener('submit', function(e) {
        flushPendingInput();
      }, true);
    })();
  `;
}

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

await page.exposeFunction('__pushStep', (stepJson) => {
  try {
    const step = JSON.parse(stepJson);
    steps.push(step);
    process.stderr.write(`[recorder] step ${steps.length}: ${step.action} ${step.selector}\n`);
  } catch (e) {
    process.stderr.write(`[recorder] parse error: ${e.message}\n`);
  }
});

await page.addInitScript(buildInitScript());

page.on('framenavigated', (frame) => {
  if (frame === page.mainFrame() && steps.length > 0) {
    const last = steps[steps.length - 1];
    if (last.waitFor !== 'networkidle') {
      steps.push({ waitFor: 'networkidle' });
      process.stderr.write(`[recorder] step ${steps.length}: waitFor networkidle (navigation)\n`);
    }
  }
});

// Re-inject on navigations since addInitScript only covers new document loads
page.on('load', async () => {
  try {
    await page.evaluate(buildInitScript());
  } catch {
    // page might have closed
  }
});

process.stderr.write(`[recorder] opening ${loginURL} — interact with the login form, then close the tab\n`);

await page.goto(loginURL, { waitUntil: 'domcontentloaded', timeout: 120000 });

await new Promise((resolve) => {
  let done = false;
  const finish = () => { if (!done) { done = true; resolve(); } };
  page.on('close', () => { process.stderr.write('[recorder] page closed\n'); finish(); });
  context.on('close', () => { process.stderr.write('[recorder] context closed\n'); finish(); });
  browser.on('disconnected', () => { process.stderr.write('[recorder] browser disconnected\n'); finish(); });
});

process.stderr.write(`[recorder] captured ${steps.length} steps\n`);
process.stdout.write(JSON.stringify(steps));

await browser.close().catch(() => {});
