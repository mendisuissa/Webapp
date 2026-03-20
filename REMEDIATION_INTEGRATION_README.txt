Remediation integration delta for prod6

Includes:
- Mount remediation router at /api/remediation
- Harden remediation route with try/catch and logging
- Return richer app metadata from resolve/execute (installerUrl, downloadPageUrl, version, confidenceScore, confidenceReasons, exportReadiness)

Remember to set REMEDIATION_SHARED_TOKEN in App Service settings if you want the second app to authenticate with a shared bearer token.
