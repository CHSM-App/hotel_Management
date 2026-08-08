// cPanel / Passenger application startup file.
//
// The CI deploy pushes the contents of backend/ to the `backend` branch, so this
// file lands at the branch root — which is where cPanel's "Setup Node.js App"
// (Phusion Passenger) looks by default for the Application Startup File.
//
// It simply boots the real server. server.js loads env vars and calls
// app.listen(); Passenger provides the port via the PORT env var and proxies
// hotel.vengurlatech.com to it, so the SPA and the API are served on one origin.
require('./src/server');
 