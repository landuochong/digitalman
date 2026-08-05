# VRM experiment third-party assets

## Female VRoid sample model

- Local file: `models/lumi-cc0.vrm`
- Source: `madjin/vrm-samples`, `vroid/fem_vroid.vrm`
- Upstream notes identify the included CC0 sample models as freely editable and usable under Creative Commons Zero.
- Source URL: https://github.com/madjin/vrm-samples

## Wardrobe and hairstyle presets

- Local files: `models/avatar-sample-a.vrm`, `models/avatar-sample-b.vrm`
- Source: `madjin/vrm-samples`, `vroid/stable/AvatarSample_A.vrm` and `AvatarSample_B.vrm`
- Terms: https://vroid.pixiv.help/hc/en-us/articles/4402394424089-VRoidPreset-A-Z
- These VRoid sample models are not CC0. VRoid permits using them as avatars, editing their textures and parameters, and redistributing edited models under the published conditions. This project does not relicense them as CC0.

## Browser renderer

- Three.js 0.180.0, MIT License: https://github.com/mrdoob/three.js
- @pixiv/three-vrm 3.5.3, MIT License: https://github.com/pixiv/three-vrm

The vendored JavaScript files retain their upstream license headers. This model is for the VRM feasibility prototype and can be replaced by a project-specific VRoid export later.

## Nike-chan v1 and v2

- Runtime files: `models/nikechan_v1.vrm`, `models/nikechan_v2.vrm`
- Source: AITuber Kit, https://github.com/tegnike/aituber-kit
- Model terms: `docs/character_model_licence_en.md` in the AITuber Kit repository.
- Permitted here only for personal use and non-commercial demonstration.
- Commercial use, modification, derivative distribution, and redistribution to third parties are generally prohibited under the upstream model terms.
- Creators: Nike-chan v1 by 琳; Nike-chan v2 by たまごん.

Because redistribution is prohibited, these two VRM binaries are intentionally ignored by Git. For a local checkout, copy them from an authorized AITuber Kit checkout into `public/vrm/models/` before starting the app.
