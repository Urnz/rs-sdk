[CmdletBinding()]
param([Parameter(Mandatory)][string]$Directory)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$fixtureKey = [Security.Cryptography.ECDsa]::Create([Security.Cryptography.ECCurve]::CreateFromFriendlyName('nistP256'))
try {
    $request = [Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=admin.invalid', $fixtureKey, [Security.Cryptography.HashAlgorithmName]::SHA256)
    $names = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $names.AddDnsName('admin.invalid')
    $names.AddIpAddress([Net.IPAddress]::Loopback)
    $request.CertificateExtensions.Add($names.Build())
    $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true, $false, 0, $true))
    $certificate = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-1), [DateTimeOffset]::UtcNow.AddDays(1))
    try {
        [IO.File]::WriteAllText((Join-Path $Directory 'certificate.crt'), $certificate.ExportCertificatePem())
        [IO.File]::WriteAllText((Join-Path $Directory 'private.pem'), $fixtureKey.ExportPkcs8PrivateKeyPem())
    } finally { $certificate.Dispose() }
} finally { $fixtureKey.Dispose() }
