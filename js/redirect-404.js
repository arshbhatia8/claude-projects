// Sends /claude-projects/<screen> to /claude-projects/#<screen>.
(function () {
  var base = "/claude-projects/";
  var rest = location.pathname.indexOf(base) === 0 ? location.pathname.slice(base.length) : '';
  var screen = rest.split('/')[0];
  var known = ['dashboard', 'transactions', 'quick', 'gmail', 'assets', 'accounts', 'liabilities', 'goals', 'reports', 'settings'];
  location.replace(base + (known.indexOf(screen) >= 0 ? '#' + screen : ''));
})();
