# AI용 내보내기 사용 가이드

## 가장 간단한 사용법

1. 장면을 만들고 카메라 구도를 정합니다.
2. 상단의 `3 AI용 내보내기`를 누릅니다.
3. 이미지 생성용 또는 영상 생성용을 선택합니다.
4. `최종 프롬프트 복사`와 기준 이미지를 먼저 사용합니다.
5. 생성 서비스가 ControlNet·Depth·Pose·Mask를 지원할 때 해당 제어 이미지를 추가합니다.

## 이미지 생성용 ZIP

```text
frames/reference.png
controls/pose.png
controls/depth.png
controls/entity_mask.png
prompts/final_prompt.txt
prompts/scene_prompt.txt
prompts/camera_prompt.txt
prompts/negative_prompt.txt
shot_manifest.json
사용법.txt
```

### 적용 순서

- `reference.png`: 이미지 참조 또는 img2img 입력
- `final_prompt.txt`: 생성 프롬프트
- `pose.png`: 자세 제어를 지원하는 모델에 입력
- `depth.png`: 공간 깊이 제어를 지원하는 모델에 입력
- `entity_mask.png`: 인페인팅·영역 제어에 입력

## 영상 생성용 ZIP

```text
frames/start_frame.png
frames/end_frame.png
controls/pose_start.png
controls/pose_end.png
controls/depth_start.png
controls/depth_end.png
controls/entity_mask_start.png
controls/entity_mask_end.png
prompts/final_prompt.txt
prompts/motion_prompt.txt
prompts/camera_prompt.txt
shot_manifest.json
사용법.txt
```

### 적용 순서

- 시작 프레임 기반 영상 모델: `start_frame.png`
- 시작·종료 프레임 지원 모델: `start_frame.png`, `end_frame.png`
- 동작 프롬프트: `motion_prompt.txt`
- 카메라 움직임: `camera_prompt.txt`
- 길이·객체·카메라 구조: `shot_manifest.json`

## 간단 내보내기

기술적인 제어 이미지가 필요하지 않을 때 사용합니다.

- 최종 프롬프트 복사
- 기준 이미지 한 장 다운로드
- 시작·종료 프레임만 ZIP 다운로드
- 모든 자료 ZIP 다운로드

## 주의

AI Scene Director가 내보낸 파일이 모든 생성 서비스에 자동으로 연결되는 것은 아닙니다. 각 서비스의 이미지 참조, 시작·종료 프레임, ControlNet 또는 마스크 입력 항목에 맞춰 파일을 선택해야 합니다. ComfyUI 연결은 `고급 도구`의 선택 기능입니다.
