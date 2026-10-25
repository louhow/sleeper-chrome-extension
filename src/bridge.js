// Messages between the extension's content scripts and page-hook.js, which
// runs in the page's own world. The two worlds share only the DOM, so every
// message is a CustomEvent on `document` with its payload as JSON in `detail`.
// Every name starts with `snp:`.
//   ask(name, detail): sends `<name>-request`; the other side answers with
//     `<name>` before dispatchEvent returns, so the parsed reply comes straight
//     back (null when nobody answered).
//   answer(name, fn): answers each `<name>-request` with fn(detail), there and then.
//   call(name, detail): for answers that take a while (an NFL lineup save): the
//     request carries an `id`, and the Promise resolves with the answer that
//     echoes it, so concurrent calls never take each other's.
//   answerLater(name, fn): call's other side; answers with what fn's Promise
//     resolves to, plus the request's `id`.
//   tell(name, detail): a one-way message; on(name, fn) listens for them.
// answer, answerLater and on return a function that stops listening. A message
// whose JSON doesn't parse is logged and dropped.
// Chrome injects a file once per frame, whichever world asks first, so this
// one can't be listed in both manifest entries: page-hook.js carries the same
// code between its "bridge.js copy" markers, and test/unit/bridge.test.js
// fails the moment the two differ. Change both together. No chrome.* here.
(globalThis.SNP ||= {}).bridge = (() => {
  // bridge.js copy: start
  function tell(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail: detail === undefined ? null : JSON.stringify(detail) }));
  }

  function on(name, fn) {
    const listener = (e) => {
      let detail;
      try {
        detail = e.detail == null ? null : JSON.parse(e.detail);
      } catch (err) {
        console.error(`[snp] bad ${name} message`, err);
        return;
      }
      fn(detail);
    };
    document.addEventListener(name, listener);
    return () => document.removeEventListener(name, listener);
  }

  function ask(name, detail) {
    let reply = null;
    const off = on(name, (x) => {
      reply = x;
    });
    tell(`${name}-request`, detail);
    off();
    return reply;
  }

  const answer = (name, fn) => on(`${name}-request`, (detail) => tell(name, fn(detail)));

  let nextId = 1;
  function call(name, detail) {
    const id = nextId++;
    return new Promise((resolve) => {
      const off = on(name, (reply) => {
        if (reply?.id !== id) return;
        off();
        resolve(reply);
      });
      tell(`${name}-request`, { ...detail, id });
    });
  }

  const answerLater = (name, fn) => on(`${name}-request`, async (detail) => tell(name, { ...(await fn(detail)), id: detail?.id ?? null }));

  return { ask, answer, call, answerLater, tell, on };
  // bridge.js copy: end
})();
