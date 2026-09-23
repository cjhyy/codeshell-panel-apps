import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { parseVideoLinks } from "../../../apps/video-download/app/download-library.js";

const source = await readFile(
  new URL("../../../apps/video-download/app/app.js", import.meta.url),
  "utf8",
);
const cookieSource = source.slice(
  source.indexOf("function cookieRequestUrl("),
  source.indexOf("function networkArguments("),
);
const cookieState = source.slice(
  source.indexOf("let cookieAccounts ="),
  source.indexOf("const ignoredProbeProcessIds"),
);

class Select {
  value = "";
  disabled = false;
  options = [];
  replaceChildren() {
    this.options = [];
    this.value = "";
  }
  append(option) {
    this.options.push(option);
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function mount({
  url = "https://www.youtube.com/watch?v=example",
  apiVersion = 10,
  taskCookies = false,
  processCookies = false,
  call,
} = {}) {
  const calls = [];
  const timers = new Map();
  const elements = {
    urlInput: {
      get value() {
        return sandbox.currentUrl || "";
      },
    },
    cookieSelect: new Select(),
    cookieRefresh: {},
    cookieLogin: {},
    cookieHelp: { textContent: "" },
  };
  const sandbox = vm.createContext({
    URL,
    parseVideoLinks,
    Error,
    Map,
    elements,
    context: {
      apiVersion,
      ...(taskCookies
        ? {
            availableMethods: [
              "credentials.cookies.listForTask",
              ...(processCookies ? ["credentials.cookies.authorizeProcess"] : []),
            ],
            capabilities: {
              tasks: { cookieCredentials: true },
              process: { cookieCredentials: processCookies },
            },
          }
        : {}),
    },
    previewMode: false,
    queueSubmissionPending: false,
    inspectionJob: null,
    runtime: { ytDlp: { handle: "yt-dlp-test-handle" } },
    currentUrl: url,
    normalizedUrl: () => sandbox.currentUrl,
    document: { createElement: () => ({}) },
    panel: {
      async call(method, params) {
        calls.push({ method, params });
        return call ? call(method, params) : { accounts: [] };
      },
    },
    updateActionAvailability() {},
    showError(message) {
      sandbox.formError = message;
    },
    setTimeout(callback) {
      const id = timers.size + 1;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  });
  vm.runInContext(
    `${source.slice(source.indexOf("function dependencyReady("), source.indexOf("function renderDependencyHealth("))}\n${cookieState}\n${cookieSource}`,
    sandbox,
  );
  return {
    elements,
    calls,
    sandbox,
    run: (code) => vm.runInContext(code, sandbox),
    changeUrl(url) {
      sandbox.currentUrl = url;
      vm.runInContext("scheduleCookieAccountsRefresh()", sandbox);
    },
    choose(id) {
      elements.cookieSelect.value = id;
      vm.runInContext("rememberCookieSelection(); invalidateCookieAuthorization();", sandbox);
    },
    flushTimers() {
      for (const callback of timers.values()) callback();
      timers.clear();
    },
  };
}

const saved = { id: "saved-youtube", label: "已保存账号", domain: "youtube.com", health: "ready" };

test("saved accounts are listed without implicit selection; explicit choices survive refresh and same-site links", async () => {
  const app = mount({ call: () => ({ accounts: [saved] }) });
  await app.run("refreshCookieAccounts()");
  assert.equal(app.elements.cookieSelect.value, "");
  assert.match(app.elements.cookieHelp.textContent, /请在上方选择/);
  assert.equal(app.elements.cookieSelect.options[1].value, saved.id);
  app.choose(saved.id);
  app.changeUrl("https://youtu.be/another-video");
  await app.run("refreshCookieAccounts()");
  assert.equal(app.elements.cookieSelect.value, saved.id);
  assert.equal(app.calls.at(-1).params.url, "https://youtube.com/");
  app.choose("");
  await app.run("refreshCookieAccounts()");
  assert.equal(app.elements.cookieSelect.value, "");
});

test("switching sites hides old accounts immediately and restores only an explicit choice on return", async () => {
  const app = mount({
    call: (_method, { url }) => ({ accounts: url.includes("youtube") ? [saved] : [] }),
  });
  await app.run("refreshCookieAccounts()");
  app.choose(saved.id);
  app.changeUrl("https://www.bilibili.com/video/BVexample");
  assert.equal(app.elements.cookieSelect.options.length, 1);
  assert.equal(app.elements.cookieSelect.value, "");
  await app.run("refreshCookieAccounts()");
  app.changeUrl("https://www.youtube.com/watch?v=return");
  await app.run("refreshCookieAccounts()");
  assert.equal(app.elements.cookieSelect.value, saved.id);
});

test("late failures and late successes cannot replace newer accounts or clear their loading state", async () => {
  const first = deferred();
  const second = deferred();
  const third = deferred();
  const pending = [first, second, third];
  const app = mount({ call: () => pending.shift().promise });
  const old = app.run("refreshCookieAccounts()");
  app.changeUrl("https://b23.tv/example");
  const current = app.run("refreshCookieAccounts()");
  first.reject(new Error("old request failed"));
  await old;
  assert.equal(app.run("cookieLoading"), true);
  assert.doesNotMatch(app.elements.cookieHelp.textContent, /failed|无法读取/);
  const last = app.run("refreshCookieAccounts()");
  third.resolve({ accounts: [{ id: "bilibili", label: "哔哩哔哩账号" }] });
  await last;
  second.resolve({ accounts: [saved] });
  await current;
  assert.equal(app.elements.cookieSelect.options[1].value, "bilibili");
  assert.equal(app.run("cookieLoading"), false);
  assert.equal(app.calls[1].params.url, "https://bilibili.com/");
});

test("unknown hosts stay scoped to their exact site and HTTP links explain unavailable cookies", async () => {
  const app = mount({ url: "https://youtu.be.attacker.example/path" });
  await app.run("refreshCookieAccounts()");
  assert.equal(app.calls[0].params.url, "https://youtu.be.attacker.example/");
  app.changeUrl("http://www.youtube.com/watch?v=example");
  await app.run("refreshCookieAccounts()");
  assert.equal(app.calls.length, 1);
  assert.equal(app.elements.cookieSelect.disabled, true);
  assert.match(app.elements.cookieHelp.textContent, /HTTPS/);
});

test("unsupported hosts do not attempt credential calls; trust failures stay actionable", async () => {
  const unsupported = mount({ apiVersion: 9 });
  await unsupported.run("refreshCookieAccounts()");
  assert.equal(unsupported.calls.length, 0);
  assert.equal(unsupported.elements.cookieSelect.disabled, true);
  assert.match(unsupported.elements.cookieHelp.textContent, /0\.8\.16/);
  const untrusted = mount({
    call: () => {
      throw new Error("Cookie login requires a trusted workspace");
    },
  });
  await untrusted.run("refreshCookieAccounts()");
  assert.match(untrusted.elements.cookieHelp.textContent, /信任当前项目/);
  assert.doesNotMatch(untrusted.elements.cookieHelp.textContent, /未找到/);
  const unavailable = mount({
    call: () => {
      throw new Error("Cookie login is unavailable in this CodeShell host");
    },
  });
  await unavailable.run("refreshCookieAccounts()");
  assert.match(unavailable.elements.cookieHelp.textContent, /未提供 Cookie 访问/);
});

test("selected accounts produce only a reusable opaque authorized file argument", async () => {
  const app = mount({
    url: "https://youtu.be/example",
    call: (method) =>
      method.endsWith(".list")
        ? { accounts: [saved] }
        : { authorized: true, fileArgumentHandle: "opaque-file-grant" },
  });
  await app.run("refreshCookieAccounts()");
  app.choose(saved.id);
  assert.deepEqual(Array.from(await app.run("cookieFileArguments(normalizedUrl())")), [
    "opaque-file-grant",
  ]);
  assert.deepEqual(Array.from(await app.run("cookieFileArguments(normalizedUrl())")), [
    "opaque-file-grant",
  ]);
  const authorizations = app.calls.filter(({ method }) => method.endsWith(".authorizeProcess"));
  assert.equal(authorizations.length, 1);
  assert.deepEqual(
    { ...authorizations[0].params },
    {
      credentialId: saved.id,
      url: "https://youtube.com/",
      executableHandle: "yt-dlp-test-handle",
    },
  );
});

test("a failed refresh never silently drops a previously chosen cookie at download time", async () => {
  let failure = false;
  const app = mount({
    call: () => {
      if (failure) throw new Error("Cookie login is unavailable in this CodeShell host");
      return { accounts: [saved] };
    },
  });
  await app.run("refreshCookieAccounts()");
  app.choose(saved.id);
  failure = true;
  await app.run("refreshCookieAccounts()");
  await assert.rejects(app.run("cookieFileArguments(normalizedUrl())"), /未提供 Cookie 访问/);
});

test("corrupted and cancelled credentials cannot be passed to the downloader", async () => {
  const app = mount({
    call: (method) =>
      method.endsWith(".list")
        ? { accounts: [saved, { id: "broken", label: "损坏账号", health: "corrupted" }] }
        : { authorized: false, cancelled: true },
  });
  await app.run("refreshCookieAccounts()");
  assert.equal(app.elements.cookieSelect.options[2].disabled, true);
  app.choose("broken");
  await assert.rejects(app.run("cookieFileArguments(normalizedUrl())"), /已失效/);
  app.choose(saved.id);
  await assert.rejects(app.run("cookieFileArguments(normalizedUrl())"), /已取消使用 Cookie/);
});

test("login save explicitly selects the account and handles site changes while its window is open", async () => {
  const login = deferred();
  const app = mount({
    call: (method) => (method.endsWith(".loginAndSave") ? login.promise : { accounts: [saved] }),
  });
  const operation = app.run("loginAndSaveCookie()");
  assert.equal(app.calls[0].params.providerLabel, "YouTube");
  assert.equal(app.elements.cookieLogin.disabled, true);
  login.resolve({ ok: true, credential: saved });
  await operation;
  assert.equal(app.elements.cookieSelect.value, saved.id);
  assert.match(app.elements.cookieHelp.textContent, /已保存并选择/);
  assert.equal(app.run("cookieLoginPending"), false);

  const changedLogin = deferred();
  const changed = mount({ call: () => changedLogin.promise });
  const changedOperation = changed.run("loginAndSaveCookie()");
  changed.changeUrl("https://bilibili.com/video/BVexample");
  changedLogin.resolve({ ok: true, credential: saved });
  await changedOperation;
  assert.equal(changed.elements.cookieSelect.value, "");
  assert.doesNotMatch(changed.elements.cookieHelp.textContent, /已保存并选择/);
});

test("cookie choices show the saved jar's next expiry without treating it as login validity", async () => {
  const account = {
    ...saved,
    cookieExpiry: {
      nextExpiryAt: "2030-01-01T00:00:00.000Z",
      persistentCount: 1,
      sessionCount: 1,
      expiredCount: 0,
    },
  };
  const app = mount({ call: () => ({ accounts: [account] }) });
  await app.run("refreshCookieAccounts()");
  assert.match(app.elements.cookieSelect.options[1].textContent, /最近持久 Cookie 到期/);
  assert.equal(app.elements.cookieSelect.options[1].value, saved.id);
});

test("clearing a failed or pending URL clears its cookie error and invalidates the old request", async () => {
  const pending = deferred();
  let next = false;
  const app = mount({
    call: () => {
      if (!next) throw new Error("Cookie login requires a trusted workspace");
      return pending.promise;
    },
  });
  await app.run("refreshCookieAccounts()");
  assert.match(app.elements.cookieHelp.textContent, /信任/);
  app.sandbox.currentUrl = null;
  app.run("clearCookieAccounts()");
  assert.match(app.elements.cookieHelp.textContent, /粘贴链接/);
  next = true;
  app.sandbox.currentUrl = "https://youtube.com/watch?v=example";
  const loading = app.run("refreshCookieAccounts()");
  app.sandbox.currentUrl = null;
  app.run("clearCookieAccounts()");
  pending.reject(new Error("late failure"));
  await loading;
  assert.match(app.elements.cookieHelp.textContent, /粘贴链接/);
  assert.equal(app.run("cookieLoading"), false);
});

test("finishing an account refresh cannot unlock selection during enqueue authorization or inspection", async () => {
  const app = mount({ call: () => ({ accounts: [saved] }) });
  app.sandbox.queueSubmissionPending = true;
  await app.run("refreshCookieAccounts()");
  assert.equal(app.elements.cookieSelect.disabled, true);
  app.sandbox.queueSubmissionPending = false;
  app.sandbox.inspectionJob = { running: true };
  app.run("renderCookieAccounts()");
  assert.equal(app.elements.cookieLogin.disabled, true);
});

test("background account discovery uses the advertised Host interface and never invokes desktop login capture", async () => {
  const account = { ...saved, revision: "a".repeat(64) };
  const app = mount({ taskCookies: true, call: () => ({ accounts: [account] }) });
  await app.run("refreshCookieAccounts()");
  assert.equal(app.calls[0].method, "credentials.cookies.listForTask");
  assert.equal(app.elements.cookieSelect.disabled, false);
  assert.equal(app.elements.cookieLogin.disabled, true);
  app.choose(account.id);
  await assert.rejects(app.run("cookieFileArguments(currentUrl)"), /尚不支持带账号读取视频信息/);
  await app.run("loginAndSaveCookie()");
  assert.equal(app.calls.length, 1);
});

test("a removed selected account stays visibly selected and cannot silently become anonymous", async () => {
  let accounts = [saved];
  const app = mount({ call: () => ({ accounts }) });
  await app.run("refreshCookieAccounts()");
  app.choose(saved.id);
  accounts = [];
  await app.run("refreshCookieAccounts()");
  assert.equal(app.elements.cookieSelect.value, saved.id);
  assert.equal(app.elements.cookieSelect.options.at(-1).disabled, true);
  await assert.rejects(app.run("cookieFileArguments(currentUrl)"), /已失效/);
  app.choose("");
  assert.equal((await app.run("cookieFileArguments(currentUrl)")).length, 0);
});

test("temporary metadata authorization carries the selected revision and never reuses a changed account", async () => {
  let revision = "a".repeat(64);
  const app = mount({
    taskCookies: true,
    processCookies: true,
    call(method) {
      return method === "credentials.cookies.listForTask"
        ? { accounts: [{ ...saved, revision }] }
        : { authorized: true, fileArgumentHandle: "sealed-file" };
    },
  });
  await app.run("refreshCookieAccounts()");
  app.choose(saved.id);
  await app.run("cookieFileArguments(currentUrl)");
  await app.run("cookieFileArguments(currentUrl)");
  assert.equal(app.calls.filter((call) => call.method.endsWith("authorizeProcess")).length, 1);
  assert.equal(app.calls.at(-1).params.revision, "a".repeat(64));
  revision = "b".repeat(64);
  await app.run("refreshCookieAccounts()");
  await app.run("cookieFileArguments(currentUrl)");
  assert.equal(app.calls.at(-1).params.revision, revision);
  assert.equal(app.calls.filter((call) => call.method.endsWith("authorizeProcess")).length, 2);
});
