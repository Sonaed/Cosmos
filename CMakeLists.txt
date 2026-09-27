cmake_minimum_required(VERSION 3.21)
project(CosmosDesktop VERSION 0.2.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTOUIC ON)
set(CMAKE_AUTORCC ON)

find_package(Qt6 6.4 REQUIRED COMPONENTS Widgets WebEngineWidgets WebChannel Concurrent)

qt_add_executable(cosmos-desktop
  native/main.cpp
  native/vault_store.h
  native/vault_store.cpp
)
target_link_libraries(cosmos-desktop PRIVATE Qt6::Widgets Qt6::WebEngineWidgets Qt6::WebChannel Qt6::Concurrent)
target_compile_definitions(cosmos-desktop PRIVATE COSMOS_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}")

install(TARGETS cosmos-desktop RUNTIME DESTINATION bin)
install(FILES index.html app.js workspace-ui.js notion.js native-client.js recovery.js styles.css cosmos-theme.css cosmos-scene.js galaxies.js graph-engine.js tools.js database.js workbench.js workbench.css icon.svg DESTINATION share/cosmos)
install(FILES vendor/markdown-it.min.js vendor/markdown-it.LICENSE DESTINATION share/cosmos/vendor)
install(FILES tests/notion-check.js DESTINATION share/cosmos/tests)
install(FILES existence-manifest.json DESTINATION share/cosmos)
install(FILES cosmos.desktop DESTINATION share/applications)
install(CODE [[
  set(launcher "$ENV{DESTDIR}${CMAKE_INSTALL_PREFIX}/share/applications/cosmos.desktop")
  file(READ "${launcher}" desktop_entry)
  string(REPLACE "Exec=cosmos-desktop" "Exec=\"${CMAKE_INSTALL_PREFIX}/bin/cosmos-desktop\"" desktop_entry "${desktop_entry}")
  file(WRITE "${launcher}" "${desktop_entry}")
]])
install(FILES icon.svg DESTINATION share/icons/hicolor/scalable/apps RENAME cosmos.svg)
