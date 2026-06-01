from pathlib import Path


GATEWAY_ROOT = Path(__file__).resolve().parents[1]


def _read_deploy_script(name: str) -> str:
    return (GATEWAY_ROOT / "deploy" / name).read_text(encoding="utf-8")


def test_install_script_defaults_to_sim_ssm_paths_and_autologin() -> None:
    install = _read_deploy_script("install.ps1")

    assert "[bool]$KgiSimulation = $true" in install
    assert "[bool]$AutoLogin = $true" in install
    assert '"/iuf/kgi/sim_person_id"' in install
    assert '"/iuf/kgi/sim_person_pwd"' in install
    assert '"/iuf/kgi/person_id"' in install
    assert '"/iuf/kgi/person_pwd"' in install
    assert '$envVars["KGI_SIMULATION"]                  = Convert-BoolToEnv $KgiSimulation' in install
    assert '$envVars["AUTO_LOGIN"]                      = Convert-BoolToEnv $AutoLogin' in install
    assert 'KGI_PERSON_PWD"] = $personPwdFromSsm.Trim()' in install


def test_nssm_script_does_not_force_live_or_disable_autologin() -> None:
    nssm = _read_deploy_script("nssm_install.ps1")

    assert "[bool]$KgiSimulation      = $true" in nssm
    assert "[bool]$AutoLogin          = $true" in nssm
    assert '"KGI_SIMULATION=$simulationEnv"' in nssm
    assert '"AUTO_LOGIN=$autoLoginEnv"' in nssm
    assert '"KGI_SIMULATION=false"' not in nssm
    assert '"AUTO_LOGIN=false"' not in nssm
    assert '"KGI_READ_ONLY_MODE=true"' in nssm
