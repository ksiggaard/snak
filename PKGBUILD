# Maintainer: Kasper Siggaard <kasper.siggaard@merkle.com>
pkgname=snak
pkgver=0.1.0
pkgrel=1
pkgdesc="Desktop LLM chat with bring-your-own-key support for multiple providers"
arch=('x86_64')
url="https://github.com/TODO/snak"
license=('MIT')
depends=(
    'webkit2gtk-4.1'
    'gtk3'
    'openssl'
    'libsecret'
    'libayatana-appindicator'
)
makedepends=(
    'rust'
    'cargo'
    'nodejs'
    'npm'
    'fuse2'           # needed to build AppImage via linuxdeploy
    'pkg-config'
)
source=("$pkgname-$pkgver.tar.gz::https://github.com/TODO/snak/archive/v$pkgver.tar.gz")
sha256sums=('SKIP')

build() {
    cd "$srcdir/$pkgname-$pkgver"
    npm ci
    APPIMAGE_EXTRACT_AND_RUN=1 npm run tauri build -- --bundles deb
}

package() {
    cd "$srcdir/$pkgname-$pkgver"
    install -Dm755 "src-tauri/target/release/$pkgname" "$pkgdir/usr/bin/$pkgname"
    install -Dm644 "src-tauri/target/release/bundle/deb/${pkgname}_${pkgver}_amd64/data/usr/share/applications/${pkgname}.desktop" \
        "$pkgdir/usr/share/applications/$pkgname.desktop"
    install -Dm644 "src-tauri/icons/128x128.png" \
        "$pkgdir/usr/share/pixmaps/$pkgname.png"
}
