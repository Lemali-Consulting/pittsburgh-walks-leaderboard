(function() {
  var script = document.currentScript || (function() {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  var iframe = document.createElement('iframe');
  iframe.src = 'https://pittsburgh-walks.lemaliconsulting.com/';
  iframe.style.cssText = 'width:100%;border:0;display:block;height:900px;';
  iframe.setAttribute('loading', 'lazy');
  iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');

  script.parentNode.insertBefore(iframe, script);

  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'leaderboard-resize') {
      iframe.style.height = e.data.height + 'px';
    }
  });
})();
