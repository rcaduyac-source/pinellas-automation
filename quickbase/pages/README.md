# Quickbase code pages

Pages here are deployed into the Construction Management_V2 app as code pages and opened with `?a=dbpage&pagename=<file>.html`.

- **Sign-in:** copy the existing QB-SESSION-SHIM (v2, from `invoice_doc_upload.html` in Quickbase) into each page. It sends calls through the signed-in user's session. Never put a user token in page code.
- **Deploy:** the legacy XML API call `API_AddReplaceDBPage`.
