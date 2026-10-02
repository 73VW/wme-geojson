// ==UserScript==
// @name         WME GeoJSON (dev)
// @namespace    wme-sdk-scripts
// @version      0.1.0
// @description  Load a GeoJSON track from a URL query parameter and identify matching Waze segments.
// @author       <user fills in>
// @match        https://www.waze.com/editor*
// @match        https://beta.waze.com/editor*
// @match        https://www.waze.com/*/editor*
// @match        https://beta.waze.com/*/editor*
// @exclude      https://www.waze.com/user/editor*
// @exclude      https://beta.waze.com/user/editor*
// @grant        GM.xmlHttpRequest
// @grant        unsafeWindow
// @connect      *
// @require		file:///path/to/wme-geojson/.out/main.user.js
// ==/UserScript==

// Dev notes:
// - In Tampermonkey's extension settings (browser, not TM), enable "Local file access".
//   See https://www.tampermonkey.net/faq.php?locale=en#Q204
// - This is a template: .devcontainer/init.sh copies it to header-dev.js (git-ignored)
//   and sets the @require path. Outside the devcontainer, copy it by hand and adjust the path.
// - Copy the block above (up to ==/UserScript==) into Tampermonkey's editor and save.
// - Run `npm run watch` to rebuild on file changes.
