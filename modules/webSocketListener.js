(function () {
    var capturedWebSocket = null;
    var originalWebSocket = window.WebSocket;

    window.WebSocket = function(url, protocols) {
        if (url.includes('chat')) {
            capturedWebSocket = url;

            var ws = new originalWebSocket(url, protocols);
            ws.addEventListener('message', function(event) {
                window.savedWebSocketData = event.data;
            });

            return ws;
        }
        return new originalWebSocket(url, protocols);
    };

    window.getCapturedWebSocketURL = function() {
        return capturedWebSocket;
    };
})();
